/**
 * douyin.ts — 抖音视频解析与下载（免 Cookie、无水印）
 * 从 backend/douyin.py 逐行翻译：
 * 短链接重定向 → 提取 video_id → 公开 API 获取元数据 → 无水印播放地址
 */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import { DEFAULT_HEADERS, MOBILE_HEADERS, formatDuration, requestWithRetry, sleep } from "./utils.js";

const URL_PATTERN = /https?:\/\/[^\s]+/i;

const DOUYIN_DOMAINS = ["douyin.com", "iesdouyin.com", "v.douyin.com", "www.douyin.com", "m.douyin.com"];

/** 判断是否为抖音链接 */
export function isDouyinUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DOUYIN_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

/** 轻量 cookie jar（实现 Python Session 的跨请求 cookie 保持） */
class CookieJar {
  private cookies = new Map<string, string>();

  set(name: string, value: string) {
    this.cookies.set(name, value);
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

interface AwemeItem {
  desc?: string;
  author?: { nickname?: string };
  statistics?: { play_count?: number; digg_count?: number };
  video?: {
    play_addr?: { url_list?: string[] };
    cover?: { url_list?: string[] };
    duration?: number;
    width?: number;
    height?: number;
  };
  music?: { play_url?: { url_list?: string[] } };
}

type PlayMode = "video" | "audio";

export class DouyinParser {
  private readonly apiUrl = "https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/";
  private readonly downloadDir: string;
  private readonly jar = new CookieJar();
  private readonly maxRetries = 3;

  constructor(downloadDir: string) {
    this.downloadDir = downloadDir;
    mkdirSync(/*turbopackIgnore: true*/ downloadDir, { recursive: true });
  }

  /** 解析视频信息 */
  async parse(url: string): Promise<VideoInfo> {
    const shareUrl = this.extractUrl(url);
    const resolvedUrl = await this.resolveRedirect(shareUrl);
    const videoId = this.extractVideoId(resolvedUrl);
    const item = await this.fetchItemInfo(videoId, resolvedUrl);
    return this.buildResult(item, videoId);
  }

  /** 下载视频/音频到本地，返回文件路径 */
  async download(url: string, mode: PlayMode = "video"): Promise<{ filepath: string; filename: string; title: string; ext: string }> {
    const shareUrl = this.extractUrl(url);
    const resolvedUrl = await this.resolveRedirect(shareUrl);
    const videoId = this.extractVideoId(resolvedUrl);
    const item = await this.fetchItemInfo(videoId, resolvedUrl);
    const mediaUrl = this.getMediaUrl(item, mode);
    const title = item.desc || `douyin_${videoId}`;

    const safeTitle =
      title
        .replace(/[\\/*?:"<>|\n\r\t#@]/g, "_")
        .replace(/_+/g, "_")
        .trim()
        .slice(0, 60) || `douyin_${videoId}`;

    const ext = mode === "video" ? "mp4" : "mp3";
    const filename = `${safeTitle}.${ext}`;
    const filepath = path.join(/*turbopackIgnore: true*/ this.downloadDir, filename);

    await this.downloadFile(mediaUrl, filepath);
    return { filepath, filename, title, ext };
  }

  private extractUrl(text: string): string {
    const match = URL_PATTERN.exec(text);
    if (!match) throw new Error("未找到有效的抖音链接");
    return match[0].trim().replace(/^["']|["']$/g, "").replace(/[).,;!?]+$/, "");
  }

  private async resolveRedirect(shareUrl: string): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const resp = await fetch(shareUrl, {
          headers: DEFAULT_HEADERS,
          redirect: "follow",
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.url;
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries - 1) await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`链接解析失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  private extractVideoId(url: string): string {
    const parsed = new URL(url);
    const query = parsed.searchParams;

    for (const key of ["modal_id", "item_ids", "group_id", "aweme_id"]) {
      const value = query.get(key);
      if (value) {
        const match = /(\d{8,24})/.exec(value);
        if (match) return match[1];
      }
    }

    for (const pattern of [/\/video\/(\d{8,24})/, /\/note\/(\d{8,24})/, /\/(\d{8,24})(?:\/|$)/]) {
      const match = pattern.exec(parsed.pathname);
      if (match) return match[1];
    }

    const fallback = /(\d{15,24})/.exec(url);
    if (fallback) return fallback[1];

    throw new Error("无法从链接中提取视频ID");
  }

  private async fetchItemInfo(videoId: string, resolvedUrl: string): Promise<AwemeItem> {
    try {
      return await this.fetchViaApi(videoId);
    } catch (e) {
      console.warn(`抖音公开API获取失败(${e instanceof Error ? e.message : e})，尝试分享页解析`);
      return this.fetchViaSharePage(videoId, resolvedUrl);
    }
  }

  private async fetchViaApi(videoId: string): Promise<AwemeItem> {
    const params = new URLSearchParams({ item_ids: videoId }).toString();
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const resp = await requestWithRetry(`${this.apiUrl}?${params}`, {
          headers: { ...DEFAULT_HEADERS, Cookie: this.jar.header() },
          timeoutMs: 30000,
        });
        const data = (await resp.json()) as { item_list?: AwemeItem[] };
        const items = data.item_list || [];
        if (items.length) return items[0];
        throw new Error("API 返回空数据");
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries - 1) await sleep(1000 * 2 ** attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("API 请求失败");
  }

  private async fetchViaSharePage(videoId: string, resolvedUrl: string): Promise<AwemeItem> {
    const parsed = new URL(resolvedUrl);
    const shareUrl = parsed.hostname.includes("iesdouyin.com")
      ? resolvedUrl
      : `https://www.iesdouyin.com/share/video/${videoId}/`;

    const resp = await fetch(shareUrl, { headers: { ...MOBILE_HEADERS, Cookie: this.jar.header() } });
    if (!resp.ok) throw new Error(`分享页请求失败: HTTP ${resp.status}`);
    let html = await resp.text();

    if (html.includes("Please wait...") && html.includes("wci=") && html.includes("cs=")) {
      html = await this.solveWafAndRetry(html, shareUrl);
    }

    const routerData = this.extractRouterData(html);
    const loaderData = routerData.loaderData || {};
    for (const node of Object.values(loaderData) as Record<string, unknown>[]) {
      if (!node || typeof node !== "object") continue;
      const videoInfoRes = (node as { videoInfoRes?: { item_list?: AwemeItem[] } }).videoInfoRes;
      if (videoInfoRes?.item_list?.length) return videoInfoRes.item_list[0];
    }
    throw new Error("分享页中未找到视频信息");
  }

  /** 解决抖音 WAF 反爬验证（sha256 前缀爆破） */
  private async solveWafAndRetry(html: string, pageUrl: string): Promise<string> {
    const match = /wci="([^"]+)"\s*,\s*cs="([^"]+)"/.exec(html);
    if (!match) return html;

    const cookieName = match[1];
    const challengeBlob = match[2];
    try {
      const decoded = decodeB64(challengeBlob);
      const challenge = JSON.parse(decoded.toString("utf-8")) as { v: { a: string; c: string }; d?: string };
      const prefix = Buffer.from(decodeB64(challenge.v.a)) as Uint8Array;
      const expected = Buffer.from(decodeB64(challenge.v.c)).toString("hex");

      let answer: string | null = null;
      for (let candidate = 0; candidate < 1_000_001; candidate++) {
        const digest = createHash("sha256").update(prefix).update(String(candidate)).digest("hex");
        if (digest === expected) {
          answer = String(candidate);
          break;
        }
      }
      if (answer === null) return html;

      challenge.d = Buffer.from(answer).toString("base64");
      const cookieValue = Buffer.from(JSON.stringify(challenge)).toString("base64");
      const domain = new URL(pageUrl).hostname || "www.iesdouyin.com";
      this.jar.set(cookieName, cookieValue);

      const resp = await fetch(pageUrl, { headers: { ...MOBILE_HEADERS, Cookie: this.jar.header() } });
      return resp.ok ? await resp.text() : html;
    } catch {
      return html;
    }
  }

  private extractRouterData(html: string): Record<string, unknown> {
    const marker = "window._ROUTER_DATA = ";
    const start = html.indexOf(marker);
    if (start < 0) return {};

    let idx = start + marker.length;
    while (idx < html.length && /\s/.test(html[idx])) idx++;
    if (idx >= html.length || html[idx] !== "{") return {};

    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let cursor = idx; cursor < html.length; cursor++) {
      const ch = html[cursor];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(idx, cursor + 1)) as Record<string, unknown>;
          } catch {
            return {};
          }
        }
      }
    }
    return {};
  }

  private getMediaUrl(item: AwemeItem, mode: PlayMode): string {
    if (mode === "video") {
      const playUrls = item.video?.play_addr?.url_list || [];
      if (!playUrls.length) throw new Error("未找到视频播放地址");
      return playUrls[0].replace("playwm", "play");
    }
    if (mode === "audio") {
      const audioUrls = item.music?.play_url?.url_list || [];
      if (!audioUrls.length) throw new Error("未找到音频地址");
      return audioUrls[0];
    }
    throw new Error(`不支持的模式: ${mode}`);
  }

  private buildResult(item: AwemeItem, videoId: string): VideoInfo {
    const title = item.desc || `抖音视频_${videoId}`;
    const author = item.author || {};
    const stats = item.statistics || {};
    const video = item.video || {};
    const playUrls = video.play_addr?.url_list || [];
    const coverUrls = video.cover?.url_list || [];
    const duration = video.duration || 0;
    const durationSec = duration > 1000 ? Math.floor(duration / 1000) : duration;

    const formats: VideoFormat[] = [];
    if (playUrls.length) {
      const cleanUrl = playUrls[0].replace("playwm", "play");
      const width = video.width || 0;
      const height = video.height || 0;
      formats.push({
        formatId: "douyin_nowm",
        ext: "mp4",
        resolution: width && height ? `${width}x${height}` : "原始",
        height: height || 720,
        filesize: null,
        vcodec: "h264",
        acodec: "aac",
        hasAudio: true,
        label: height ? `无水印 MP4 (${height}p)` : "无水印 MP4 (原始画质)",
        url: cleanUrl,
      });
    }

    return {
      id: videoId,
      title,
      description: title.slice(0, 200),
      thumbnail: coverUrls[0] || "",
      duration: durationSec,
      uploader: author.nickname || "抖音用户",
      platform: "douyin",
      viewCount: stats.play_count || stats.digg_count || undefined,
      url: `https://www.douyin.com/video/${videoId}`,
      formats,
      subtitles: [],
    };
  }

  /** 下载文件到本地（带 .part 临时文件与重试） */
  private async downloadFile(url: string, filepath: string, chunkSize = 64 * 1024): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const resp = await fetch(url, { headers: DEFAULT_HEADERS, redirect: "follow" });
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
        const tempPath = filepath + ".part";
        const buffer = Buffer.from(await resp.arrayBuffer());
        writeFileSync(/*turbopackIgnore: true*/ tempPath, buffer);
        renameSync(/*turbopackIgnore: true*/ tempPath, filepath);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries - 1) await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`文件下载失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}

function decodeB64(value: string): Buffer {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  normalized += "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized, "base64");
}

export { formatDuration };