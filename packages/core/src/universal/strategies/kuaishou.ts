/**
 * kuaishou.ts — 快手策略
 *
 * 实测结论（2026-09-15，v.kuaishou.com/n9s0TDfH 示例）：
 *  - 短链 v.kuaishou.com/{code} → 302 → www.kuaishou.com/short-video/{photoId}
 *  - 关键：桌面 UA 直接抓 www.kuaishou.com 返回 `{"result":2}` 风控空页；**移动 UA** 可完整拿到 SSR 页面（164KB）
 *  - SSR 内嵌 window.INIT_STATE = {...}（顶层部分 key 经字符位移混淆，但 JSON.parse 可直接成功，无需解码）
 *  - 遍历可找到 photo 节点（photoType === "VIDEO" 且 mainMvUrls 为数组）：
 *    photoId / caption / userName / userId / duration(ms) / width / height / viewCount / likeCount
 *    mainMvUrls[0].url（kwaicdn 无水印 mp4）/ coverUrls[0].url
 *  - 下载 Referer：https://www.kuaishou.com
 */
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import type { PlatformStrategy, StrategyContext, UniversalError } from "../types.js";
import { UniversalError as UE } from "../types.js";

function hostMatch(host: string): boolean {
  return host === "kuaishou.com" || host.endsWith(".kuaishou.com") || host === "chenzhongtech.com" || host.endsWith(".chenzhongtech.com");
}

/** 从还原后的 URL 提取 photoId（path /short-video/{id} 或 query photoId=） */
function extractPhotoId(url: string): string | null {
  const m = /\/(?:short-video|fw\/photo)\/([0-9A-Za-z]+)/.exec(url);
  if (m) return m[1];
  const q = /[?&]photoId=([0-9A-Za-z]+)/.exec(url);
  return q ? q[1] : null;
}

/** 遍历 INIT_STATE 找第一个含 mainMvUrls 的视频节点（预序遍历，实测首个即当前视频） */
function findVideoNode(state: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!state) return null;
  let found: Record<string, unknown> | null = null;
  (function walk(node: unknown): void {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.mainMvUrls) && obj.mainMvUrls.length) {
      found = obj;
      return;
    }
    for (const v of Object.values(obj)) walk(v);
  })(state);
  return found;
}

export const kuaishouStrategy: PlatformStrategy = {
  id: "kuaishou",
  label: "快手",
  match: hostMatch,
  referer: "https://www.kuaishou.com",
  ua: "mobile", // 桌面 UA 触发 result:2 风控，移动 UA 可拿完整 SSR

  async resolve(ctx: StrategyContext): Promise<VideoInfo> {
    const { http } = ctx;
    const input = ctx.extractUrl(ctx.url);

    // 1. 短链还原（移动 UA）
    const finalUrl = await http.resolveFinal(input, { Accept: "text/html,*/*" });
    const photoId = extractPhotoId(finalUrl);
    if (!photoId) throw new UE("unsupported", "无法从快手链接中识别视频 ID");

    // 2. 移动 UA 抓 SSR 页
    const page = await http.getHtml(`https://www.kuaishou.com/short-video/${photoId}`, {
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    const state = http.extractJsonByMarker(page, "window.INIT_STATE");
    const photo = findVideoNode(state);
    if (!photo) throw new UE("not_found", "快手页面数据缺失或已失效");

    const mainUrls = (photo.mainMvUrls as Record<string, unknown>[]) || [];
    const directUrl = (mainUrls[0]?.url as string) || "";
    if (!directUrl) throw new UE("not_found", "未找到快手视频播放地址");

    const coverList = Array.isArray(photo.coverUrls) ? (photo.coverUrls as Record<string, unknown>[]) : [];
    const durationMs = typeof photo.duration === "number" ? photo.duration : 0;

    const format: VideoFormat = {
      formatId: "kuaishou_nowm",
      ext: "mp4",
      resolution:
        typeof photo.width === "number" && typeof photo.height === "number" ? `${photo.width}x${photo.height}` : "原始",
      height: typeof photo.height === "number" ? photo.height : undefined,
      filesize: null,
      vcodec: "h264",
      acodec: "aac",
      hasAudio: true,
      label: "无水印 MP4 (快手)",
      url: directUrl,
    };

    return {
      id: String(photo.photoId || photoId),
      title: String(photo.caption || "快手视频").slice(0, 200),
      description: typeof photo.caption === "string" ? photo.caption.slice(0, 200) : undefined,
      thumbnail: (coverList[0]?.url as string) || "",
      duration: durationMs ? Math.floor(durationMs / 1000) : undefined,
      uploader: (photo.userName as string) || "快手用户",
      uploaderId: photo.userId != null ? String(photo.userId) : undefined,
      viewCount: typeof photo.viewCount === "number" ? photo.viewCount : undefined,
      platform: "kuaishou",
      directUrl,
      formats: [format],
      subtitles: [],
      url: ctx.url,
    };
  },
};

export type { UniversalError };