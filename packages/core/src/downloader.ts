/**
 * downloader.ts — yt-dlp 通用封装（解析 / 下载 / 直链）
 * 通过 spawn 子进程调用系统 yt-dlp，不依赖 Python。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import { resolveProxyForUrl, expandDomesticShortUrl, isBilibiliUrl } from "./proxy.js";
export { resolveOutboundProxy } from "./proxy.js";
import { formatFilesize, sanitizeFilename, sleep } from "./utils.js";

/** yt-dlp 原始 info 中的 format */
interface RawFormat {
  format_id?: string;
  ext?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  url?: string;
  resolution?: string;
  format_note?: string;
}

/** yt-dlp raw info object（结构化字段子集） */
export interface YtDlpInfo {
  id?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  duration_string?: string;
  uploader?: string;
  channel?: string;
  extractor?: string;
  extractor_key?: string;
  view_count?: number;
  upload_date?: string;
  description?: string;
  url?: string;
  ext?: string;
  requested_formats?: Array<{ url?: string; ext?: string }>;
  formats?: RawFormat[];
  subtitles?: Record<string, unknown[]>;
  automatic_captions?: Record<string, unknown[]>;
}

/** 执行 yt-dlp 并返回完整 stdout；配置了出站代理时自动加 --proxy。
 *  对 403/5xx/网络抖动等瞬时错误自动重试（TikTok/YouTube 反爬多为此类，重试可恢复）。 */
export async function runYtDlp(
  args: string[],
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<string> {
  const retries = opts.retries ?? 1;
  let lastErr: Error = new Error("yt-dlp 执行失败");

  // b23.tv 等短链先展开为完整链接（见 proxy.ts），确保走专用提取器、代理判定基于展开后 URL
  const rawUrl = targetUrlFromArgs(args);
  if (rawUrl) {
    const expanded = await expandDomesticShortUrl(rawUrl);
    if (expanded !== rawUrl) {
      args = args.map((a) => (a === rawUrl ? expanded : a));
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(3000 * attempt); // 3s / 6s 退避
    try {
      return await spawnYtDlpOnce(args, opts);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === retries || !isRetryableYtDlpError(lastErr)) throw lastErr;
    }
  }
  throw lastErr;
}

/** 是否值得重试：瞬时风控(403/429)、5xx、网络中断、网页抓取失败 */
function isRetryableYtDlpError(err: Error): boolean {
  const m = err.message.toLowerCase();
  if (/(\b403\b|\b429\b)/.test(m)) return true;
  if (/http error 5\d\d/.test(m)) return true;
  if (/transporterror|connection|timed out|unable to download webpage|econnaborted|econnreset/.test(m)) return true;
  // 反爬确认类：TikTok/YouTube 的临时挑战与页面异常，重试常可恢复
  if (/unexpected response from webpage/.test(m)) return true;
  return false;
}

/** 从 yt-dlp 参数中提取目标 URL（parse/download/direct 调用均以 URL 作为最后参数） */
function targetUrlFromArgs(args: string[]): string {
  for (let i = args.length - 1; i >= 0; i--) {
    if (/^https?:\/\//i.test(args[i])) return args[i];
  }
  return "";
}

function spawnYtDlpOnce(args: string[], opts: { timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const targetUrl = targetUrlFromArgs(args);
    // 国内站点直连、仅海外站点走代理（判定见 proxy.ts）
    const proxy = resolveProxyForUrl(targetUrl);
    const fullArgs = proxy ? ["--proxy", proxy, ...args] : args;
    // B 站在 CloudBase 数据中心 IP 直连被 WAF 412：环境变量 BILIBILI_IMPERSONATE=1 时给 B 站调用
    // 追加 --impersonate chrome（curl_cffi 伪装 Chrome TLS 指纹），尝试绕过；本地默认关闭不影响现状。
    const impersonate = /^(1|true|yes)$/i.test(process.env.BILIBILI_IMPERSONATE ?? "");
    if (impersonate && isBilibiliUrl(targetUrl)) fullArgs.unshift("--impersonate", "chrome");
    const child = spawn("yt-dlp", fullArgs, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp 执行超时"));
    }, opts.timeoutMs ?? 120_000);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 yt-dlp：${err.message}。请确认已安装 yt-dlp。`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `yt-dlp 退出码 ${code}`));
    });
  });
}

/** 检测 ffmpeg 是否可用（音视频合并需要） */
export function hasFfmpeg(): boolean {
  const res = spawnSync("ffmpeg", ["-version"], { windowsHide: true, timeout: 5000, encoding: "utf8" });
  return !res.error && res.status === 0;
}

/**
 * 聚合页（Vimeo customer 页、部分官网页面等）→ 具体视频 URL 的内存缓存。
 * parse 阶段解析出后写入，download/direct-url 阶段复用，避免重复完整解析。
 * 键为用户输入 URL，值为解析后的具体视频页 URL。
 */
const AGGREGATE_CACHE = new Map<string, string>();

/** 聚合页里"最佳视频条目"的评分：formats 越多越优先；generic/html5 兜底解析降权 */
function aggregateScore(e: YtDlpInfo): number {
  const n = Array.isArray(e.formats) ? e.formats.length : 0;
  const generic = e.extractor === "generic" || e.extractor === "html5" ? -1 : 0;
  return n + generic;
}

export class VideoDownloader {
  readonly downloadDir: string;
  readonly ffmpegAvailable: boolean;

  constructor(downloadDir: string) {
    this.downloadDir = downloadDir;
    this.ffmpegAvailable = hasFfmpeg();
  }

  private baseArgs(download: boolean): string[] {
    return [
      "--quiet",
      "--no-warnings",
      "--no-playlist",
      ...(download ? [] : ["--skip-download"]),
    ];
  }

  /** 解析视频信息 */
  async parseVideo(url: string): Promise<VideoInfo> {
    const args = [
      ...this.baseArgs(false),
      "--dump-single-json",
      url,
    ];
    const stdout = await runYtDlp(args);
    let info: YtDlpInfo & { _type?: string; entries?: YtDlpInfo[] };
    try {
      info = JSON.parse(stdout) as YtDlpInfo & { _type?: string; entries?: YtDlpInfo[] };
    } catch {
      throw new Error("yt-dlp 输出无法解析");
    }

    // 聚合页（Vimeo customer 页等）：--no-playlist 下 yt-dlp 返回懒播放列表（无 formats）。
    // 完整解析全部条目取"最佳视频"，并把 url 指向该具体视频页，保证后续直链/下载可用。
    if (info._type === "playlist" && Array.isArray(info.entries)) {
      const target = await this.resolveAggregate(url);
      if (target) {
        AGGREGATE_CACHE.set(url, target.targetUrl);
        return this.toVideoInfo(target.entry, url, target.targetUrl);
      }
      throw new Error("该页面包含多个视频且无法确定目标视频，请直接粘贴视频页链接");
    }

    return this.toVideoInfo(info, url);
  }

  /** raw yt-dlp info → VideoInfo；targetUrl 存在时覆盖返回的 url（聚合页场景） */
  private toVideoInfo(info: YtDlpInfo, sourceUrl: string, targetUrl?: string): VideoInfo {
    const formats = this.extractFormats(info);
    const platform = info.extractor || info.extractor_key || "Unknown";

    const subtitles = Object.entries(info.subtitles || {}).map(([lang, list]) => ({
      language: lang,
      auto: false,
      ...(Array.isArray(list) && list.length > 0 ? { url: (list[0] as { url?: string }).url } : {}),
    }));
    const autoSubs = Object.entries(info.automatic_captions || {}).slice(0, 5).map(([lang, list]) => ({
      language: lang,
      auto: true,
      ...(Array.isArray(list) && list.length > 0 ? { url: (list[0] as { url?: string }).url } : {}),
    }));

    return {
      id: info.id || "",
      title: info.title || "未知标题",
      thumbnail: info.thumbnail || "",
      description: (info.description || "").slice(0, 200),
      duration: info.duration,
      uploader: info.uploader || info.channel || "未知",
      platform,
      viewCount: info.view_count,
      uploadDate: info.upload_date || "",
      url: targetUrl || sourceUrl,
      formats,
      subtitles: [...subtitles, ...autoSubs],
    };
  }

  /**
   * 聚合页解析：完整 dump 全部条目（不带 --no-playlist），
   * 选出 formats 最多的真实视频条目（generic/html5 兜底解析降权）。
   * 返回具体视频页 URL（webpage_url）与该条目 raw info；非聚合页返回 null。
   */
  async resolveAggregate(url: string): Promise<{ targetUrl: string; entry: YtDlpInfo } | null> {
    const stdout = await runYtDlp(
      ["--quiet", "--no-warnings", "--skip-download", "--dump-single-json", url],
      { timeoutMs: 300_000 }
    );
    let j: YtDlpInfo & { _type?: string; entries?: YtDlpInfo[] };
    try {
      j = JSON.parse(stdout) as YtDlpInfo & { _type?: string; entries?: YtDlpInfo[] };
    } catch {
      return null;
    }
    if (j._type !== "playlist" || !Array.isArray(j.entries) || !j.entries.length) return null;
    if (j.entries.length > 50) return null; // 真实大列表（YouTube 播放列表等）不归并，维持原行为

    const usable = j.entries
      .filter((e) => Array.isArray(e.formats) && e.formats.length > 0)
      .sort((a, b) => aggregateScore(b) - aggregateScore(a));
    const best = usable[0];
    if (!best) return null;

    const targetUrl =
      (best as YtDlpInfo & { webpage_url?: string }).webpage_url ||
      (best as YtDlpInfo & { original_url?: string }).original_url ||
      best.url ||
      url;
    return { targetUrl, entry: best };
  }

  /** 从 raw formats 提取整理为前端可用列表 */
  extractFormats(info: YtDlpInfo): VideoFormat[] {
    const raw = (info.formats || []) as RawFormat[];
    if (!raw.length) return [];

    const seen = new Set<string>();
    const results: VideoFormat[] = [];

    for (const f of raw) {
      const vcodec = f.vcodec || "none";
      const acodec = f.acodec || "none";
      const height = f.height;
      const ext = f.ext || "mp4";

      // 视频流判定：vcodec 缺失时（vqq 等 extractor 不填充编码信息）退化为按分辨率识别
      const hasVideo = (vcodec !== "none" && !!vcodec) || !!height || !!f.width;
      if (!hasVideo) continue;

      const filesize = f.filesize || f.filesize_approx;
      const sizeLabel = formatFilesize(filesize);

      const key = `${height}|${ext}|${acodec !== "none" ? "av" : "v"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        formatId: f.format_id || "",
        ext,
        resolution: height ? `${f.width || "?"}x${height}` : "未知",
        height: height || 0,
        filesize: filesize || null,
        filesizeApprox: filesize || null,
        vcodec,
        acodec: acodec !== "none" ? acodec : null,
        hasAudio: acodec !== "none",
        label: height
          ? `${height}p ${ext.toUpperCase()} (${sizeLabel})${acodec === "none" ? " 仅视频" : ""}`
          : `${ext.toUpperCase()} (${sizeLabel})`,
      });
    }

    results.sort((a, b) => (b.height || 0) - (a.height || 0));

    if (results.length && !results.some((r) => r.hasAudio)) {
      results.unshift({
        formatId: "bestvideo+bestaudio/best",
        ext: "mp4",
        resolution: results[0].resolution,
        height: results[0].height || 0,
        filesize: null,
        vcodec: "best",
        acodec: "merged",
        hasAudio: true,
        label: `${results[0].height || ""}p 最佳 (视频+音频合并)`,
      });
    }

    return results.slice(0, 15);
  }

  /** 服务端下载视频（audio=true 时仅提取音频并转 mp3），返回落盘路径 */
  async downloadVideo(
    url: string,
    formatId: string,
    opts: { audio?: boolean } = {}
  ): Promise<{ filepath: string; filename: string; title: string; ext: string }> {
    const isAudio = !!opts.audio;
    let fmt = isAudio ? "bestaudio/best" : formatId;
    if (!this.ffmpegAvailable && fmt.includes("+")) fmt = "best";

    // 聚合页场景：parse 阶段已解析出具体视频页（见 parseVideo），直接下载该页而非整页
    const targetUrl = AGGREGATE_CACHE.get(url) || url;

    const args = [
      ...this.baseArgs(true),
      "--format", fmt,
      "--output", path.join(this.downloadDir, "%(title)s.%(ext)s"),
      "--paths", this.downloadDir,
      "--print", "after_move:filepath",
      ...(isAudio
        ? ["--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"]
        : []),
      ...(this.ffmpegAvailable && !isAudio ? ["--merge-output-format", "mp4"] : []),
      targetUrl,
    ];
    const stdout = await runYtDlp(args, { timeoutMs: 600_000 });

    let filepath = stdout.trim().split("\n").pop()?.trim() || "";
    if (!filepath || !existsSync(/*turbopackIgnore: true*/ filepath)) {
      // 兜底：在下载目录中按标题前缀查找最新文件
      const title = await this.getTitle(url);
      const match = readdirSync(/*turbopackIgnore: true*/ this.downloadDir).find((f) => f.includes(sanitizeFilename(title).slice(0, 30)) || f.includes(title.slice(0, 20)));
      if (match) filepath = path.join(this.downloadDir, match);
    }
    if (!filepath || !existsSync(/*turbopackIgnore: true*/ filepath)) throw new Error("下载失败：未找到输出文件");

    const filename = path.basename(filepath);
    return {
      filepath,
      filename,
      title: filename.replace(/\.[^.]+$/, ""),
      ext: filename.split(".").pop() || "mp4",
    };
  }

  /** 获取视频直链（带宽友好，优先方案） */
  async getDirectUrl(url: string, formatId: string): Promise<{ directUrl: string; ext: string; filesize: number | null; title: string }> {
    const args = [
      ...this.baseArgs(false),
      "--format", formatId,
      "--dump-single-json",
      url,
    ];
    const stdout = await runYtDlp(args);
    let info: YtDlpInfo & { _type?: string };
    try {
      info = JSON.parse(stdout) as YtDlpInfo & { _type?: string };
    } catch {
      throw new Error("无法解析直链信息");
    }

    // 聚合页：--no-playlist 下返回懒播放列表 → 解析到具体视频页后重试
    if (info._type === "playlist") {
      const cached = AGGREGATE_CACHE.get(url);
      const target = cached ? { targetUrl: cached } : await this.resolveAggregate(url);
      if (target) {
        AGGREGATE_CACHE.set(url, target.targetUrl);
        return this.getDirectUrl(target.targetUrl, formatId);
      }
      throw new Error("该页面包含多个视频且无法确定目标视频，请直接粘贴视频页链接");
    }

    let directUrl = info.url || "";
    if (!directUrl && info.requested_formats?.length) {
      directUrl = info.requested_formats[0].url || "";
    }
    if (!directUrl) throw new Error("该视频不支持直链下载，请使用服务端下载模式");

    return {
      directUrl,
      ext: info.ext || "mp4",
      filesize: null,
      title: info.title || "video",
    };
  }

  private async getTitle(url: string): Promise<string> {
    try {
      const parsed = await this.parseVideo(url);
      return parsed.title;
    } catch {
      return "video";
    }
  }
}

/** yt-dlp 错误分类（供上层做友好提示） */
export type YtDlpErrorKind =
  | "network" // 连不上目标平台（超时/拒绝/无法下载网页）
  | "anti_bot" // 平台反爬校验（TikTok 等对数据中心 IP / 无浏览器指纹）
  | "needs_cookie" // 需要登录 Cookie
  | "unsupported" // 不支持该链接/平台
  | "drm" // 视频受数字版权保护（Vimeo 等品牌视频常见），无法离线下载
  | "missing" // 环境缺少 yt-dlp / ffmpeg
  | "timeout" // 我们自设的超时
  | "unknown";

/** 各错误分类的中文友好提示 */
export const YTDLP_ERROR_HINTS: Record<YtDlpErrorKind, string> = {
  network: "无法连接到该视频平台（网络不可达或超时），请确认网络可用后重试。",
  anti_bot: "该平台风控拦截了本次请求（反爬校验或访问过于频繁）。请稍等 1~2 分钟再试，或更换网络出口节点。",
  needs_cookie: "该视频需要登录平台账号才能解析，当前暂不支持。",
  unsupported: "暂不支持此链接或平台，请确认链接是否来自支持的视频平台。",
  drm: "该视频受数字版权保护（DRM），无法离线下载。可在原始平台应用内观看。",
  missing: "服务端缺少 yt-dlp / ffmpeg 组件，请检查部署环境。",
  timeout: "解析超时（视频所在平台响应较慢），请稍后重试。",
  unknown: "解析失败，请稍后重试。",
};

/** 根据 yt-dlp 报错文本归类问题类型 */
export function classifyYtDlpError(err: unknown): YtDlpErrorKind {
  const lower = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (lower.includes("无法启动 yt-dlp")) return "missing";
  if (lower.includes("yt-dlp 执行超时")) return "timeout";
  if (lower.includes("unsupported url") || lower.includes("no video formats") || lower.includes("is not a valid url")) {
    return "unsupported";
  }
  if (lower.includes("drm") && (lower.includes("protect") || lower.includes("encrypted") || lower.includes("drm"))) return "drm";
  if (lower.includes("fresh cookies") || lower.includes("needs cookie") || lower.includes("cookie")) return "needs_cookie";
  // 403/429 = 平台风控（TikTok/YouTube 高频访问或地区限制），先于网络类判定
  if (
    (lower.includes("403") && (lower.includes("forbidden") || lower.includes("error 403"))) ||
    lower.includes("429 too many") ||
    lower.includes("unexpected response from webpage") ||
    lower.includes("impersonat") ||
    lower.includes("challenge") ||
    lower.includes("captcha") ||
    lower.includes("verify you are human") ||
    lower.includes("georestricted") ||
    lower.includes("the page needs to be reloaded")
  ) {
    return "anti_bot";
  }
  if (lower.includes("http error 404") || lower.includes("http error 410")) return "unsupported";
  if (lower.includes("timed out") || lower.includes("transporterror") || lower.includes("unable to download webpage") || lower.includes("connection")) {
    return "network";
  }
  return "unknown";
}

/** 将 yt-dlp 异常转换为一句用户能看懂的中文提示（供各 API 统一使用） */
export function friendlyYtDlpError(err: unknown): string {
  return YTDLP_ERROR_HINTS[classifyYtDlpError(err)];
}