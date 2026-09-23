/**
 * bilibili.ts — B 站视频自定义解析（官方 API，绕开网页 WAF）
 *
 * 背景：CloudBase 数据中心 IP 抓 www.bilibili.com 网页被 WAF 412 拦截（yt-dlp 拿不到页面）。
 * 方案：不抓网页，直接调 api.bilibili.com 官方接口 —— 先拿 buvid 访客 cookie，
 *   view 接口取元数据与 cid，wbi 签名后的 playurl 接口取 DASH 直链。
 *   CDN 直链下载时带 Referer/Cookie，音视频流用 ffmpeg 合并。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, renameSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import { expandDomesticShortUrl } from "./proxy.js";
import { sanitizeFilename, sleep } from "./utils.js";

/** 桌面 Chrome UA（官方 API 对 UA 有风控，必须携带） */
const BILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const BILI_BV = /BV[0-9A-Za-z]{10}/;

/** 判断是否为 B 站普通视频稿链接（video 页 / b23.tv 短链 / bvid/av 参数） */
export function isBiliVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const isBili = host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "b23.tv" || host.endsWith(".b23.tv");
    if (!isBili) return false;
    // b23.tv 短链分享的基本都是视频稿；其余需含 bvid/av
    if (host === "b23.tv" || host.endsWith(".b23.tv")) return true;
    return BILI_BV.test(url) || /(^|[?&])bvid=/i.test(url) || /\bav\d+/i.test(url);
  } catch {
    return false;
  }
}

/** B 站解析/下载错误分类（供上层做友好提示） */
export type BilibiliErrorKind =
  | "anti_bot" // 风控拦截（-412 等），需稍后重试或换出口
  | "network" // 网络不可达 / 接口超时
  | "unsupported" // 非普通视频稿（番剧/专栏/空间等）或视频不存在
  | "missing_ffmpeg" // 合并音视频/转 mp3 需要 ffmpeg
  | "unknown";

export class BilibiliError extends Error {
  constructor(
    message: string,
    readonly kind: BilibiliErrorKind = "unknown"
  ) {
    super(message);
    this.name = "BilibiliError";
  }
}

export const BILIBILI_ERROR_HINTS: Record<BilibiliErrorKind, string> = {
  anti_bot: "B 站风控拦截了本次请求。请稍等 1~2 分钟再试；若在云环境频繁出现，建议更换网络出口。",
  network: "无法连接到 B 站接口（网络不可达或超时），请确认网络可用后重试。",
  unsupported: "暂不支持此链接或视频不存在，请粘贴 B 站普通视频（/video/BV…）链接。",
  missing_ffmpeg: "服务端缺少 ffmpeg 组件，无法合并音视频/转 MP3，请检查部署环境。",
  unknown: "解析失败，请稍后重试。",
};

/** 轻量 cookie jar（跨请求保持 buvid 等访客 cookie） */
class CookieJar {
  private cookies = new Map<string, string>();

  set(name: string, value: string) {
    this.cookies.set(name, value);
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  has() {
    return this.cookies.size > 0;
  }
}

/** wbi 签名用 mixin key 置换表（B 站前端算法） */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** 取文件名的 wbi 密钥段：img_url/sub_url 末尾文件名去扩展名 */
function wbiKeyFromUrl(url: string): string {
  const name = url.split("/").pop() || "";
  return name.split(".")[0];
}

/** 由 img_key+sub_key 生成 32 位 mixin key */
function genMixinKey(imgKey: string, subKey: string): string {
  const raw = createHash("md5").update(imgKey + subKey).digest("hex");
  return MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join("").slice(0, 32);
}

/** wbi 签名：参数排序 + wts 时间戳 + w_rid=md5(查询串+mixinKey) */
function signWbi(params: Record<string, string | number>, mixinKey: string): string {
  const entries = Object.entries(params).map(([k, v]) => [k, String(v)] as const);
  const wts = Math.round(Date.now() / 1000);
  entries.push(["wts", String(wts)]);
  const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
  const query = sorted.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const wRid = createHash("md5").update(query + mixinKey).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

/** dash 视频流 */
interface DashVideo {
  id: number;
  baseUrl: string;
  backupUrl?: string[];
  bandwidth?: number;
  codecs?: string;
  width?: number;
  height?: number;
  frameRate?: number;
}
/** dash 音频流 */
interface DashAudio {
  id: number;
  baseUrl: string;
  backupUrl?: string[];
  bandwidth?: number;
  codecs?: string;
}

interface PlayUrlData {
  dash?: { video?: DashVideo[]; audio?: DashAudio[] };
  durl?: Array<{ url?: string; backup_url?: string[] }>;
}

interface ViewData {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  pic?: string;
  desc?: string;
  duration?: number;
  owner?: { name?: string };
  stat?: { view?: number };
  pages?: Array<{ cid: number; page?: number; part?: string }>;
}

const QUALITY_LABELS: Record<number, string> = {
  127: "8K", 126: "杜比视界", 125: "HDR", 120: "4K", 116: "1080P60",
  112: "1080P+", 80: "1080P", 64: "720P", 32: "480P", 16: "360P",
};

/** h264(avc) 兼容性最好优先；hevc(hev) 次之；av1 最后 */
function codecRank(codecs?: string): number {
  if (!codecs) return 3;
  if (/avc|\.264|avc1/i.test(codecs)) return 0;
  if (/hev|\.265/i.test(codecs)) return 1;
  if (/av01/i.test(codecs)) return 2;
  return 3;
}

function codecShort(codecs?: string): string {
  if (!codecs) return "";
  if (/avc/i.test(codecs)) return "H.264";
  if (/hev/i.test(codecs)) return "H.265";
  if (/av01/i.test(codecs)) return "AV1";
  return (codecs.split(".")[0] || codecs).toUpperCase();
}

export class BilibiliParser {
  private readonly downloadDir: string;
  private readonly jar = new CookieJar();
  private readonly maxRetries = 3;
  private buvidReady = false;

  constructor(downloadDir: string) {
    this.downloadDir = downloadDir;
    mkdirSync(/*turbopackIgnore: true*/ downloadDir, { recursive: true });
  }

  /** 解析视频信息 */
  async parse(url: string): Promise<VideoInfo> {
    const ctx = await this.resolveVideo(url);
    return this.buildResult(ctx);
  }

  /** 获取直链（带宽友好优先）：返回最佳 DASH 视频流地址 */
  async getDirectUrl(url: string): Promise<{ directUrl: string; ext: string; filesize: number | null; title: string }> {
    const ctx = await this.resolveVideo(url);
    const videoUrl = pickVideoUrl(ctx);
    if (!videoUrl) throw new BilibiliError("该视频没有可用的播放流", "unsupported");
    return { directUrl: videoUrl, ext: "mp4", filesize: null, title: ctx.title };
  }

  /** 下载视频（合并音视频）或仅音频（转 mp3），返回落盘路径 */
  async download(
    url: string,
    mode: "video" | "audio" = "video"
  ): Promise<{ filepath: string; filename: string; title: string; ext: string }> {
    const ctx = await this.resolveVideo(url);
    const safeTitle = sanitizeFilename(ctx.title).trim().slice(0, 60) || `bilibili_${ctx.bvid}`;
    const dir = /*turbopackIgnore: true*/ this.downloadDir;

    const videoUrl = pickVideoUrl(ctx);
    const audioUrl = pickAudioUrl(ctx);
    if (!videoUrl && !audioUrl) throw new BilibiliError("该视频没有可用的播放流", "unsupported");

    const tmpV = path.join(dir, `.bili-${ctx.bvid}.v.m4s`);
    const tmpA = path.join(dir, `.bili-${ctx.bvid}.a.m4s`);

    // 单文件流（durl MP4，已含音轨，或无法拆分时）：直接下载
    if (!videoUrl) {
      // 仅音频模式：直接下 MP4 再用 ffmpeg 抽音轨转 mp3；否则原样保存
      if (mode === "audio") {
        if (!this.ffmpegAvailable()) throw new BilibiliError("缺少 ffmpeg，无法提取音频", "missing_ffmpeg");
        await this.downloadStream(audioUrl!, tmpA);
        const filepath = path.join(dir, `${safeTitle}.mp3`);
        this.runFfmpeg(["-y", "-i", tmpA, "-c:a", "libmp3lame", "-q:a", "0", filepath]);
        rmSync(/*turbopackIgnore: true*/ tmpA, { force: true });
        return { filepath, filename: path.basename(filepath), title: safeTitle, ext: "mp3" };
      }
      const filepath = path.join(dir, `${safeTitle}.mp4`);
      await this.downloadStream(audioUrl!, filepath);
      return { filepath, filename: path.basename(filepath), title: safeTitle, ext: "mp4" };
    }

    // 音频模式：只下音频流转 mp3
    if (mode === "audio") {
      if (!audioUrl) throw new BilibiliError("该视频无独立音轨，无法提取音频", "unsupported");
      if (!this.ffmpegAvailable()) throw new BilibiliError("缺少 ffmpeg，无法转 MP3", "missing_ffmpeg");
      await this.downloadStream(audioUrl, tmpA);
      const filepath = path.join(dir, `${safeTitle}.mp3`);
      this.runFfmpeg(["-y", "-i", tmpA, "-c:a", "libmp3lame", "-q:a", "0", filepath]);
      rmSync(/*turbopackIgnore: true*/ tmpA, { force: true });
      return { filepath, filename: path.basename(filepath), title: safeTitle, ext: "mp3" };
    }

    // 视频模式：下视频流 + 音轨 → ffmpeg 合并
    const filepath = path.join(dir, `${safeTitle}.mp4`);
    await this.downloadStream(videoUrl, tmpV);
    if (audioUrl && this.ffmpegAvailable()) {
      await this.downloadStream(audioUrl, tmpA);
      try {
        this.runFfmpeg(["-y", "-i", tmpV, "-i", tmpA, "-c", "copy", "-movflags", "+faststart", filepath]);
        rmSync(/*turbopackIgnore: true*/ tmpV, { force: true });
        rmSync(/*turbopackIgnore: true*/ tmpA, { force: true });
        return { filepath, filename: path.basename(filepath), title: safeTitle, ext: "mp4" };
      } catch {
        // 合并失败（格式不兼容等）回退为纯视频
        rmSync(/*turbopackIgnore: true*/ tmpA, { force: true });
      }
    }
    // 无音轨 / 无 ffmpeg / 合并失败 → 仅视频
    renameSync(/*turbopackIgnore: true*/ tmpV, filepath);
    return { filepath, filename: path.basename(filepath), title: safeTitle, ext: "mp4" };
  }

  // ---------- 内部实现 ----------

  /** 解析结果上下文 */
  private async resolveVideo(rawUrl: string): Promise<{
    bvid: string;
    cid: number;
    title: string;
    view: ViewData;
    play: PlayUrlData;
  }> {
    const url = await this.expandUrl(rawUrl);
    const bvid = this.extractBvid(url);
    await this.ensureBuvid();
    await this.ensureWbiKeys();

    const view = await this.fetchView(bvid, url);
    const part = this.extractPart(url);
    const cid = part && view.pages?.[part - 1]?.cid ? view.pages[part - 1].cid : view.cid;

    const play = await this.fetchPlayUrl(bvid, cid);
    if (!play.dash?.video?.length && !play.durl?.length) {
      throw new BilibiliError("B 站未返回可播放的视频流（可能需登录会员）", "unknown");
    }
    return { bvid, cid, title: view.title, view, play };
  }

  /** b23.tv 短链展开（跟随 302 拿 Location，不读 body，规避 WAF 412） */
  private async expandUrl(raw: string): Promise<string> {
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      return raw;
    }
    if (host !== "b23.tv" && !host.endsWith(".b23.tv")) return raw;

    // 先试现成的展开逻辑（带浏览器 UA 跟随重定向）
    const expanded = await expandDomesticShortUrl(raw);
    if (BILI_BV.test(expanded) || /\/video\//.test(expanded)) return expanded;

    // 兜底：手动跟随重定向链（只读 Location，不消费 body）
    let cur = raw;
    try {
      for (let hop = 0; hop < 6; hop++) {
        const resp = await this.request(cur, {}, "manual");
        const location = resp.headers.get("location");
        if (!location) break;
        cur = new URL(location, cur).href;
        if (BILI_BV.test(cur)) return cur.replace(/[?#].*$/, "");
      }
    } catch {
      /* 展开失败回退原链接 */
    }
    return cur;
  }

  private extractBvid(url: string): string {
    const short = BILI_BV.exec(url);
    if (short) return short[0];
    try {
      const bvidQ = new URL(url).searchParams.get("bvid");
      if (bvidQ && BILI_BV.test(bvidQ)) return BILI_BV.exec(bvidQ)![0];
      const av = /av(\d{4,})/i.exec(url);
      if (av) {
        // aid → bvid 转换走 view 接口（fetchView 支持 aid 参数）
        return `av${av[1]}`;
      }
    } catch {
      /* ignore */
    }
    throw new BilibiliError("无法从链接中解析出 B 站视频号", "unsupported");
  }

  /** 分 P 参数（?p=N / ?page=N） */
  private extractPart(url: string): number | undefined {
    try {
      const p = Number(new URL(url).searchParams.get("p") || new URL(url).searchParams.get("page"));
      return Number.isInteger(p) && p > 0 ? p : undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureBuvid(): Promise<void> {
    if (this.buvidReady) return;
    try {
      const data = await this.getJson<{ b_3?: string; b_4?: string }>(
        "https://api.bilibili.com/x/frontend/finger/spi"
      );
      if (data?.b_3) this.jar.set("buvid3", data.b_3);
      if (data?.b_4) this.jar.set("buvid4", data.b_4);
      this.buvidReady = true;
    } catch {
      /* buvid 获取失败不阻塞，继续尝试（部分接口缺 buvid 也能过） */
      this.buvidReady = true;
    }
  }

  private wbiMixinKey = "";
  private wbiFetched = false;

  private async ensureWbiKeys(): Promise<void> {
    if (this.wbiFetched) return;
    try {
      const data = await this.getJson<{ wbi_img?: { img_url?: string; sub_url?: string } }>(
        "https://api.bilibili.com/x/web-interface/nav"
      );
      const img = data?.wbi_img?.img_url;
      const sub = data?.wbi_img?.sub_url;
      if (img && sub) {
        this.wbiMixinKey = genMixinKey(wbiKeyFromUrl(img), wbiKeyFromUrl(sub));
      }
    } catch {
      /* 取 wbi 密钥失败 */
    }
    this.wbiFetched = true;
  }

  private getApiHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": BILI_UA,
      Referer: "https://www.bilibili.com/",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Origin: "https://www.bilibili.com",
    };
    if (extra) Object.assign(headers, extra);
    return headers;
  }

  /** 统一请求：携带 UA/Referer + buvid cookie，收集 set-cookie */
  private async request(
    url: string,
    headers?: Record<string, string>,
    redirect: "follow" | "manual" = "follow",
    timeoutMs = 30_000
  ): Promise<Response> {
    const h = this.getApiHeaders(headers);
    const cookie = this.jar.header();
    if (cookie && !h.Cookie) h.Cookie = cookie;
    const resp = await fetch(url, { headers: h, redirect, signal: AbortSignal.timeout(timeoutMs) });
    this.collectCookies(resp);
    return resp;
  }

  private collectCookies(resp: Response): void {
    let setCookies: string[] = [];
    try {
      const list = (resp.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
      if (list && list.length) setCookies = list;
    } catch {
      /* ignore */
    }
    for (const sc of setCookies) {
      const pair = (sc.split(";")[0] ?? "").trim();
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /** GET JSON 校验 code===0，并自动处理网络重试 */
  private async getJson<T>(url: string, extraHeaders?: Record<string, string>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const resp = await this.request(url, extraHeaders);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = (await resp.json().catch(() => null)) as { code?: number; data?: T; message?: string } | null;
        if (!body) throw new Error("接口返回为空");
        if (body.code === 0 && body.data !== undefined) return body.data;
        if (typeof body.code === "number" && body.code !== 0) {
          const msg = body.message || `code=${body.code}`;
          if (body.code === -412) throw new BilibiliError(`B 站风控拦截（-412）：${msg}`, "anti_bot");
          throw new Error(`code ${body.code}：${msg}`);
        }
        return body as unknown as T;
      } catch (e) {
        lastErr = e;
        if (e instanceof BilibiliError) throw e; // 风控等无需重试
        if (attempt < this.maxRetries - 1) await sleep(600 * 2 ** attempt);
      }
    }
    throw new BilibiliError(`B 站接口请求失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, "network");
  }

  /** view 接口：元数据 + cid（bvid= 或 aid= 两种兼容） */
  private async fetchView(bvid: string, sourceUrl: string): Promise<ViewData> {
    const key = bvid.startsWith("av") ? "aid" : "bvid";
    const value = bvid.startsWith("av") ? bvid.slice(2) : bvid;
    const data = await this.getJson<ViewData>(
      `https://api.bilibili.com/x/web-interface/view?${key}=${encodeURIComponent(value)}`
    );
    if (!data || !data.bvid) throw new BilibiliError("视频不存在或已被删除", "unsupported");
    return data;
  }

  /** playurl 接口：wbi 签名取 DASH / durl 播放流 */
  private async fetchPlayUrl(bvid: string, cid: number): Promise<PlayUrlData> {
    const params: Record<string, string | number> = {
      bvid,
      cid,
      qn: 127,
      fnval: 16,
      fnver: 0,
      fourk: 1,
    };
    const query = this.wbiMixinKey ? signWbi(params, this.wbiMixinKey) : new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString();
    const data = await this.getJson<PlayUrlData>(`https://api.bilibili.com/x/player/wbi/playurl?${query}`);
    return data ?? {};
  }

  /** 转换为前端可展示的 formats（DASH 视频流；durl 兜底单流） */
  private extractFormats(ctx: {
    view: ViewData;
    play: PlayUrlData;
  }): { formats: VideoFormat[]; directUrl?: string } {
    const formats: VideoFormat[] = [];
    const dash = ctx.play.dash;
    if (dash?.video?.length) {
      // 同一清晰度多编码时只保留兼容性最好的一个（avc > hevc > av1）
      const byQuality = new Map<number, DashVideo>();
      for (const v of dash.video) {
        const cur = byQuality.get(v.id);
        if (!cur || codecRank(v.codecs) < codecRank(cur.codecs)) byQuality.set(v.id, v);
      }
      const videos = [...byQuality.values()].sort((a, b) => (b.height || 0) - (a.height || 0));
      for (const v of videos) {
        const height = v.height || 0;
        const label = `${QUALITY_LABELS[v.id] || (height ? `${height}p` : `q${v.id}`)}${
          v.frameRate && v.frameRate >= 50 ? "60帧" : ""
        } ${codecShort(v.codecs)} (DASH)`;
        formats.push({
          formatId: `dash_${v.id}`,
          ext: "mp4",
          resolution: v.width && height ? `${v.width}x${height}` : undefined,
          height,
          filesize: null,
          vcodec: v.codecs || "h264",
          acodec: null,
          hasAudio: false,
          label,
          url: v.baseUrl,
        });
      }
    } else if (ctx.play.durl?.length && ctx.play.durl[0].url) {
      const url = ctx.play.durl[0].url;
      formats.push({
        formatId: "mp4",
        ext: "mp4",
        resolution: "原始",
        height: 0,
        filesize: null,
        vcodec: "h264",
        acodec: "aac",
        hasAudio: true,
        label: "MP4 (已含音轨)",
        url,
      });
    }
    return { formats, directUrl: formats[0]?.url };
  }

  private buildResult(ctx: {
    bvid: string;
    title: string;
    view: ViewData;
    play: PlayUrlData;
  }): VideoInfo {
    const { formats, directUrl } = this.extractFormats(ctx);
    const v = ctx.view;
    return {
      id: v.bvid || ctx.bvid,
      title: ctx.title,
      description: (v.desc || "").slice(0, 200),
      thumbnail: v.pic || "",
      duration: v.duration,
      uploader: v.owner?.name || "B 站用户",
      viewCount: v.stat?.view,
      uploadDate: "",
      platform: "bilibili",
      directUrl,
      url: `https://www.bilibili.com/video/${v.bvid || ctx.bvid}`,
      formats,
      subtitles: [],
    };
  }

  /** 流式下载到文件（带 CDN 所需 Referer/Cookie 与重试） */
  private async downloadStream(fileUrl: string, filepath: string): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const candidates = attempt === 0 ? [fileUrl] : this.backupUrls(fileUrl);
      for (const url of candidates) {
        try {
          const resp = await this.request(url, { Accept: "*/*" }, "follow", 300_000);
          if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
          await this.pipeToFile(resp.body, filepath);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      if (attempt < this.maxRetries - 1) await sleep(800 * 2 ** attempt);
    }
    throw new BilibiliError(
      `视频流下载失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      "network"
    );
  }

  private backupUrls(url: string): string[] {
    // 备份地址未知，重试时直接重下目标地址
    return [url];
  }

  private pipeToFile(body: ReadableStream<Uint8Array>, filepath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tmp = filepath + ".part";
      const ws = createWriteStream(tmp);
      const nodeBody = Readable.fromWeb(body as never);
      nodeBody.on("error", reject);
      ws.on("error", reject);
      nodeBody.pipe(ws);
      ws.on("finish", () => {
        // close 回调后 .part 已落盘，改名到位
        ws.close(() => {
          try {
            renameSync(/*turbopackIgnore: true*/ tmp, filepath);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  }

  private ffmpegAvailable(): boolean {
    const res = spawnSync("ffmpeg", ["-version"], { windowsHide: true, timeout: 5000, encoding: "utf8" });
    return !res.error && res.status === 0;
  }

  private runFfmpeg(args: string[]): void {
    const res = spawnSync("ffmpeg", args, { windowsHide: true, timeout: 600_000, encoding: "utf8" });
    if (res.error || res.status !== 0) {
      throw new BilibiliError(`ffmpeg 执行失败：${res.stderr || res.error?.message || ""}`, "unknown");
    }
    const out = args[args.length - 1];
    if (out && !existsSync(/*turbopackIgnore: true*/ out)) {
      throw new BilibiliError("ffmpeg 未生成输出文件", "unknown");
    }
  }
}

/** 挑选最佳 DASH 视频流（高清 + avc 优先） */
function pickVideoUrl(ctx: { play: PlayUrlData }): string | null {
  const videos = ctx.play.dash?.video;
  if (videos?.length) {
    const sorted = [...videos].sort((a, b) => {
      const h = (b.height || 0) - (a.height || 0);
      if (h !== 0) return h;
      return codecRank(a.codecs) - codecRank(b.codecs);
    });
    return sorted[0]?.baseUrl || null;
  }
  return ctx.play.durl?.[0]?.url || null;
}

/** 挑选最佳 DASH 音频流（AAC 优先，跳过杜比/无损） */
function pickAudioUrl(ctx: { play: PlayUrlData }): string | null {
  const audios = ctx.play.dash?.audio;
  if (!audios?.length) return null;
  const usable = audios.filter((a) => !/ec-3|flac/i.test(a.codecs || ""));
  const pool = usable.length ? usable : audios;
  const sorted = [...pool].sort(
    (a, b) => (b.bandwidth || 0) - (a.bandwidth || 0)
  );
  return sorted[0]?.baseUrl || null;
}