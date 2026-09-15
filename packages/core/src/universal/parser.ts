/**
 * universal/parser.ts — UniversalParser 统一解析器
 *
 * 流程：定位平台策略 → 构筑共享 http（按策略 UA 形态）→ strategy.resolve
 * 错误统一收敛为 UniversalError，路由层据此输出与 yt-dlp 侧一致的中文文案。
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { VideoInfo } from "@saveany/shared";
import { sanitizeFilename, sleep, DESKTOP_UA } from "../utils.js";
import { UniversalHttp, extractUrl } from "./http.js";
import { findPlatform } from "./platform-registry.js";
import { UniversalError, type UniversalErrorKind } from "./types.js";

/** 将任意异常归类为 UniversalError（供路由层统一提示） */
export function classifyUniversalError(e: unknown): UniversalError {
  if (e instanceof UniversalError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (/fetch failed|network|abort|timeout|超时|connect|econn|resolve|dns|certificate/i.test(lower)) {
    return new UniversalError("network", msg);
  }
  if (/403|429|forbidden|风控|反爬|验证|block|robot|too many/i.test(lower)) {
    return new UniversalError("anti_bot", msg);
  }
  return new UniversalError("unknown", msg);
}

/** 统一中文提示（与 downloader.ts 的 YTDLP_ERROR_HINTS 风格一致） */
export const UNIVERSAL_ERROR_HINTS: Record<UniversalErrorKind, string> = {
  network: "无法连接到该视频平台（网络不可达或超时），请确认网络可用后重试。",
  anti_bot: "该平台风控拦截了本次请求（反爬校验或访问过于频繁）。请稍等 1~2 分钟再试，或更换网络出口节点。",
  needs_login: "该视频需要登录对应平台账号才能解析，当前暂不支持。",
  not_found: "视频不存在、已删除或为私密内容，请确认链接是否有效。",
  unsupported: "暂不支持此链接或平台，请确认链接是否来自支持的视频平台。",
  unknown: "解析失败，请稍后重试。",
};

export function friendlyUniversalError(err: unknown): string {
  return UNIVERSAL_ERROR_HINTS[classifyUniversalError(err).kind];
}

export interface DirectUrlResult {
  directUrl: string;
  ext: string;
  filesize: number | null;
  title: string;
}

export class UniversalParser {
  private readonly downloadDir: string;

  constructor(downloadDir: string) {
    this.downloadDir = downloadDir;
    mkdirSync(/*turbopackIgnore: true*/ downloadDir, { recursive: true });
  }

  /** 解析：策略给出 VideoInfo + 单一直链格式 */
  async parse(input: string): Promise<VideoInfo> {
    const strategy = findPlatform(input);
    if (!strategy) throw new UniversalError("unsupported", "暂不支持此链接或平台");
    try {
      const http = new UniversalHttp({ ua: strategy.ua ?? "desktop" });
      const info = await strategy.resolve({ http, url: input, extractUrl });
      if (!info.directUrl) {
        const f = info.formats.find((x) => x.url);
        if (f?.url) info.directUrl = f.url;
      }
      return info;
    } catch (e) {
      throw classifyUniversalError(e);
    }
  }

  /** 直链（下载/播放用） */
  async getDirectUrl(input: string): Promise<DirectUrlResult> {
    const info = await this.parse(input);
    const f = info.formats.find((x) => x.url);
    if (!f?.url) throw new UniversalError("not_found", "未找到可下载的直链");
    return { directUrl: f.url, ext: f.ext || "mp4", filesize: null, title: info.title };
  }

  /** 按直链流式下载（带策略 Referer 防 CDN 403） */
  async download(input: string): Promise<{ filepath: string; filename: string; title: string; ext: string }> {
    const strategy = findPlatform(input);
    const info = await this.parse(input);
    const f = info.formats.find((x) => x.url);
    if (!f?.url) throw new UniversalError("not_found", "未找到可下载的直链");
    const ext = f.ext || "mp4";
    if (ext === "m3u8") throw new UniversalError("unsupported", "该视频为 HLS 分片流，暂不支持直链下载");

    const safeName = (sanitizeFilename(info.title).trim().slice(0, 60) || "video").replace(/\s+/g, " ");
    const filename = `${safeName}.mp4`;
    const filepath = path.join(/*turbopackIgnore: true*/ this.downloadDir, filename);

    await this.downloadFile(f.url, filepath, strategy?.referer);
    return { filepath, filename, title: info.title, ext: "mp4" };
  }

  /** 直链落盘（带 .part 临时文件与重试，模式同 douyin.ts） */
  private async downloadFile(url: string, filepath: string, referer?: string, maxRetries = 3): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = { "User-Agent": DESKTOP_UA };
        if (referer) headers.Referer = referer;
        const resp = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(120_000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const tempPath = filepath + ".part";
        const buffer = Buffer.from(await resp.arrayBuffer());
        writeFileSync(/*turbopackIgnore: true*/ tempPath, buffer);
        renameSync(/*turbopackIgnore: true*/ tempPath, filepath);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries - 1) await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`文件下载失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}