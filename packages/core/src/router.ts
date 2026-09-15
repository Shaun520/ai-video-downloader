/**
 * router.ts — 统一平台路由层
 * 分发顺序：抖音 → 通用解析框架（小红书/微博/快手/微信视频号/QQ短视频）→ yt-dlp。
 * 消除 API 路由与容器服务里硬编码的 isDouyinUrl 双分支。
 */
import { DouyinParser, isDouyinUrl } from "./douyin.js";
import { VideoDownloader, friendlyYtDlpError } from "./downloader.js";
import { findPlatform, UniversalParser, UniversalError, UNIVERSAL_ERROR_HINTS, type DirectUrlResult } from "./universal/index.js";

export type { DirectUrlResult } from "./universal/index.js";

export type PlatformRoute = "douyin" | "universal" | "ytdlp";

/** 统一错误出口：UniversalError 走框架提示，其余走 yt-dlp 归类 */
export function friendlyRouteError(err: unknown): string {
  if (err instanceof UniversalError) return UNIVERSAL_ERROR_HINTS[err.kind];
  return friendlyYtDlpError(err);
}

/** 判断链接走哪条解析通路 */
export function detectPlatform(url: string): PlatformRoute {
  if (isDouyinUrl(url)) return "douyin";
  if (findPlatform(url)) return "universal";
  return "ytdlp";
}

export async function parseUrl(url: string, downloadDir: string) {
  const route = detectPlatform(url);
  if (route === "douyin") return new DouyinParser(downloadDir).parse(url);
  if (route === "universal") return new UniversalParser(downloadDir).parse(url);
  return new VideoDownloader(downloadDir).parseVideo(url);
}

export async function directUrl(url: string, formatId: string | undefined, downloadDir: string): Promise<DirectUrlResult> {
  const route = detectPlatform(url);
  if (route === "douyin") {
    const info = await new DouyinParser(downloadDir).parse(url);
    const f = info.formats.find((x) => x.url);
    return { directUrl: (f?.url as string) || info.directUrl || "", ext: "mp4", filesize: null, title: info.title };
  }
  if (route === "universal") return new UniversalParser(downloadDir).getDirectUrl(url);
  return new VideoDownloader(downloadDir).getDirectUrl(url, formatId || "best");
}

export async function downloadUrl(
  url: string,
  formatId: string | undefined,
  opts: { audio?: boolean } | undefined,
  downloadDir: string
): Promise<{ filepath: string; filename: string; title: string; ext: string }> {
  const route = detectPlatform(url);
  if (route === "douyin") {
    return new DouyinParser(downloadDir).download(url, opts?.audio === true || formatId === "mp3" ? "audio" : "video");
  }
  if (route === "universal") {
    // 音频模式暂不做转码（保持简单）：统一下载视频直链
    return new UniversalParser(downloadDir).download(url);
  }
  return new VideoDownloader(downloadDir).downloadVideo(url, formatId || "best", { audio: opts?.audio === true || formatId === "mp3" });
}