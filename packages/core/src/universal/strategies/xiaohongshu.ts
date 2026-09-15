/**
 * xiaohongshu.ts — 小红书策略
 *
 * 实测结论（2026-09-15，xhslink 短链示例）：
 *  - 短链 https://xhslink.cn/o/{id} → 302 → https://www.xiaohongshu.com/explore/{noteId}
 *  - explore 页匿名可访问，SSR 内嵌 window.__INITIAL_STATE__（偶含裸 undefined，需替换为 null 再 parse）
 *  - 视频节点：noteData.data.noteData，key 含 title/desc/user/cover/video/type/interactInfo/time(noteId=unix ms)
 *  - 无水印直链：noteData.data.noteData.video.media.stream.h264[0].masterUrl（h265[0] 备选）
 *  - 时长：stream.h264[0].videoDuration（毫秒）；上传者：user.nickName；封面：cover(仅 fileId)/imageList
 *  - 下载 Referer：https://www.xiaohongshu.com（CDN 校验来源）
 */
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import type { PlatformStrategy, StrategyContext, UniversalError } from "../types.js";
import { UniversalError as UE } from "../types.js";

function hostMatch(host: string): boolean {
  return host === "xhslink.cn" || host.endsWith(".xhslink.cn") || host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com");
}

/** 提取 noteId：explore/{id} / discovery/item/{id} / 短链还原后 */
function extractNoteId(url: string): string | null {
  const m = /\/(?:explore|discovery\/item|item)\/([0-9a-zA-Z]+)/.exec(url);
  return m ? m[1] : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export const xiaohongshuStrategy: PlatformStrategy = {
  id: "xiaohongshu",
  label: "小红书",
  match: hostMatch,
  referer: "https://www.xiaohongshu.com",
  /** 桌面 UA 匿名访问返回首页 feed SSR；移动 UA 才返回笔记详情页数据（noteData） */
  ua: "mobile",

  async resolve(ctx: StrategyContext): Promise<VideoInfo> {
    const { http } = ctx;
    const input = ctx.extractUrl(ctx.url);

    // 1. 短链还原并解析 noteId
    let finalUrl: string;
    let noteId = extractNoteId(input);
    if (!noteId) {
      finalUrl = await http.resolveFinal(input, { Accept: "text/html,*/*" });
      noteId = extractNoteId(finalUrl);
      if (!noteId) throw new UE("unsupported", "无法从小红书链接中识别笔记 ID");
    } else {
      finalUrl = input;
    }

    // 2. 移动 UA + 匿名 cookie 抓详情页（移动端页面数据完整、登录引导少）
    const page = await http.getHtml(finalUrl, {
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    const state = http.extractJsonByMarker(page, "window.__INITIAL_STATE__", { replaceUndefined: true });
    const note = asRecord(http.getByPath(state, "noteData.data.noteData"));
    if (!note) throw new UE("not_found", "小红书页面数据缺失或已失效");

    if (note.type !== "video") throw new UE("unsupported", "该笔记不包含视频");

    // 3. 视频流：优先 h264，其次 h265
    const streams = (asRecord(http.getByPath(note, "video.media.stream")) || {}) as Record<string, unknown>;
    const pick = (key: string): Record<string, unknown> | null => {
      const arr = streams[key];
      return Array.isArray(arr) && arr.length ? asRecord(arr[0]) : null;
    };
    const h264 = pick("h264");
    const h265 = pick("h265") || h264;
    const streamInfo = h264 || h265;
    const masterUrl = asRecord(streamInfo && (streamInfo as Record<string, unknown>))?.masterUrl as string | undefined;
    if (!masterUrl) throw new UE("not_found", "未找到视频播放地址");

    // masterUrl 为 http 或带水印库地址，统一转 https
    const directUrl = masterUrl.startsWith("http://") ? "https://" + masterUrl.slice(7) : masterUrl;

    const durationMs = (streamInfo as Record<string, unknown>)?.videoDuration as number | undefined;
    const interactive = asRecord(http.getByPath(note, "interactInfo"));
    const user = asRecord(http.getByPath(note, "user"));
    const uploadDate = typeof note.time === "number" ? new Date(note.time).toISOString().slice(0, 10) : undefined;

    const format: VideoFormat = {
      formatId: "universal_h264",
      ext: "mp4",
      resolution:
        typeof streamInfo?.width === "number" && typeof streamInfo?.height === "number"
          ? `${streamInfo.width}x${streamInfo.height}`
          : "原始",
      height: (streamInfo?.height as number) || undefined,
      filesize: null,
      vcodec: "h264",
      acodec: "aac",
      hasAudio: true,
      label: "无水印 MP4 (小红书)",
      url: directUrl,
    };

    return {
      id: String(note.noteId || noteId),
      title: String(note.title || "小红书视频").slice(0, 200),
      description: typeof note.desc === "string" ? note.desc.slice(0, 200) : undefined,
      thumbnail:
        (asRecord(http.getByPath(note, "imageList[0]"))?.urlDefault as string) || String((note.cover as Record<string, unknown>)?.url || "") || "",
      duration: durationMs ? Math.floor(durationMs / 1000) : undefined,
      uploader: (user?.nickName as string) || "小红书用户",
      uploaderId: user?.userId ? String(user.userId) : undefined,
      viewCount: interactive?.likedCount ? Number(interactive.likedCount) : undefined,
      uploadDate,
      platform: "xiaohongshu",
      directUrl,
      formats: [format],
      subtitles: [],
      url: input,
    };
  },
};

export type { UniversalError };