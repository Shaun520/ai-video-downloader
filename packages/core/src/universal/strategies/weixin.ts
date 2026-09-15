/**
 * weixin.ts — 微信视频号策略
 *
 * 实测结论（2026-09-15，weixin.qq.com/sph/Ah4wlTxsjZ 示例）：
 *  - 短链 302 → channels.weixin.qq.com/finder-preview/pages/sph?id={id}（SPA 壳，无 SSR 数据）
 *  - 页面自带预览 API：POST {base}/finder-preview/api/feed/get_feed_info
 *    体：{"baseReq":{"generalToken":"<warmup 获得的 token cookie>"},"shortUri":"{id}"}
 *    响应：HTTP 201，errCode:0，data.feedInfo / data.authorInfo / data.sceneInfo
 *  - **匿名访问只能拿到元数据**：feedInfo 仅有 picInfo/description/计数/coverUrl，无 videoUrl / h264VideoInfo
 *  - 无水印直链需登录微信获取分享凭证 → 抛 needs_login（不提供假数据）
 */
import type { VideoInfo } from "@saveany/shared";
import type { PlatformStrategy, StrategyContext, UniversalError } from "../types.js";
import { UniversalError as UE } from "../types.js";

const API = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info";
const PAGE = "https://channels.weixin.qq.com/finder-preview/pages/sph";

function hostMatch(host: string): boolean {
  return host === "weixin.qq.com" || host.endsWith(".weixin.qq.com") || host === "channels.weixin.qq.com" || host.endsWith(".channels.weixin.qq.com");
}

function extractShareId(url: string): string | null {
  const path = /\/sph\/([A-Za-z0-9_-]+)/.exec(url);
  if (path) return path[1];
  const query = /[?&]id=([A-Za-z0-9_-]+)/.exec(url);
  return query ? query[1] : null;
}

interface FeedInfo {
  feedInfo?: {
    description?: string;
    coverUrl?: string;
    videoUrl?: string;
    h264VideoInfo?: { url?: string };
    likeCountFmt?: string;
    favCountFmt?: string;
    commentCountFmt?: string;
    createtime?: number;
  };
  authorInfo?: { nickname?: string; headImgUrl?: string };
  sceneInfo?: unknown;
}

export const weixinStrategy: PlatformStrategy = {
  id: "weixin",
  label: "微信视频号",
  match: hostMatch,
  referer: "https://channels.weixin.qq.com/",

  async resolve(ctx: StrategyContext): Promise<VideoInfo> {
    const { http } = ctx;
    const input = ctx.extractUrl(ctx.url);
    const shareId = extractShareId(input);
    if (!shareId) throw new UE("unsupported", "无法从微信视频号链接中识别分享 ID");

    // warmup：走一遍预览页加载链，落地 token 等会话 cookie
    await http.getHtml("https://channels.weixin.qq.com/", { Accept: "text/html,*/*" });
    await http.getHtml(`${PAGE}?id=${shareId}`, { Accept: "text/html,*/*", "Accept-Language": "zh-CN,zh;q=0.9" });
    const generalToken = http.jar.get("token") || "";

    const data = await http.postJson<{ data?: FeedInfo; errCode?: number }>(
      API,
      { baseReq: { generalToken }, shortUri: shareId },
      { Referer: `${PAGE}?id=${shareId}`, Accept: "*/*" }
    );
    const payload = data?.data || {};
    const feed = payload.feedInfo || {};
    const author = payload.authorInfo || {};

    const directUrl = (feed.videoUrl as string) || feed.h264VideoInfo?.url || "";
    if (!directUrl) {
      // 匿名拿不到可播放地址：不返回假数据，明确提示需要登录
      throw new UE("needs_login", "微信视频号需要登录微信获取分享凭证，暂无法解析无水印直链");
    }

    return {
      id: shareId,
      title: String(feed.description || "微信视频号视频").replace(/\s+/g, " ").slice(0, 200),
      description: typeof feed.description === "string" ? feed.description.slice(0, 200) : undefined,
      thumbnail: feed.coverUrl || author.headImgUrl || "",
      uploader: author.nickname || "微信视频号用户",
      uploadDate: typeof feed.createtime === "number" ? new Date(feed.createtime * 1000).toISOString().slice(0, 10) : undefined,
      platform: "weixin",
      directUrl,
      formats: [
        {
          formatId: "weixin_nowm",
          ext: "mp4",
          resolution: "原始",
          filesize: null,
          vcodec: "h264",
          acodec: "aac",
          hasAudio: true,
          label: "无水印 MP4 (微信视频号)",
          url: directUrl,
        },
      ],
      subtitles: [],
      url: ctx.url,
    };
  },
};

export type { UniversalError };