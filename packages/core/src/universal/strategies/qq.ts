/**
 * qq.ts — QQ 短视频（腾讯频道）策略
 *
 * 实测结论（2026-09-15，pd.qq.com/hs/cmhuyrb74 示例）：
 *  - pd.qq.com 分享页 SSR 可匿名访问（无需 cookie），视频地址直接内嵌在 HTML 文本中
 *  - 视频直链形如：https://qchannelvideo.photo.qq.com/{file}.mp4?dis_k=...&dis_t=...（dis_t 为过期戳，拿到尽快下载）
 *  - 标题：<meta property="og:title">（去掉尾部"｜腾讯频道"）；封面 og:image
 *  - 描述/作者：meta name=description 含"…，由{作者}发布在腾讯频道…"
 *  - 下载 Referer：https://pd.qq.com
 */
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import type { PlatformStrategy, StrategyContext, UniversalError } from "../types.js";
import { UniversalError as UE } from "../types.js";

function hostMatch(host: string): boolean {
  return host === "pd.qq.com" || host.endsWith(".pd.qq.com") || host === "q.qq.com" || host.endsWith(".q.qq.com");
}

/** 简单 HTML 实体还原（og meta 可能出现 &#x27; 等） */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html: string, propOrName: string, attr: "property" | "name"): string | null {
  const re = new RegExp(`<meta[^>]+${attr}="${propOrName}"[^>]+content="([^"]*)"`);
  const m = re.exec(html);
  if (m) return decodeEntities(m[1]);
  const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}="${propOrName}"`);
  const m2 = re2.exec(html);
  return m2 ? decodeEntities(m2[1]) : null;
}

export const qqStrategy: PlatformStrategy = {
  id: "qq",
  label: "QQ短视频",
  match: hostMatch,
  referer: "https://pd.qq.com",

  async resolve(ctx: StrategyContext): Promise<VideoInfo> {
    const { http } = ctx;
    const input = ctx.extractUrl(ctx.url);

    const finalUrl = await http.resolveFinal(input, { Accept: "text/html,*/*" });
    const html = await http.getHtml(finalUrl, {
      Referer: "https://pd.qq.com/",
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });

    // 视频直链：优先 qchannelvideo 的 mp4，其次任意内嵌 mp4/m3u8
    // 注意尾部必须是贪婪量词（懒量词会吞掉 ?dis_k=…&dis_t=… 签名），且 HTML 里 & 写作 &amp;
    const candidates = (html.match(/https:[^"'\\\s]{0,240}\.mp4[^"'\\\s]{0,120}/g) || []).map((u) =>
      decodeEntities(u)
    );
    const direct =
      candidates.find((u) => u.includes("qchannelvideo")) ||
      candidates[0] ||
      html.match(/https:[^"'\\\s]{0,240}\.m3u8[^"'\\\s]{0,120}/)?.[0] ||
      "";
    if (!direct) throw new UE("not_found", "未找到 QQ 短视频播放地址");

    const rawTitle = metaContent(html, "og:title", "property") || (/(?:<title>)([^<]*)/.exec(html)?.[1] || "");
    const title = rawTitle.replace(/[｜丨]\s*腾讯频道\s*$/, "").trim() || "QQ短视频";

    const rawDescription =
      metaContent(html, "og:description", "property") || metaContent(html, "description", "name") || "";
    // 描述尾部的官方模板尾巴（"…发布在腾讯频道【腾讯频道】同好交流版块…"）截掉，保留正文
    const description = rawDescription.split("【腾讯频道】")[0].trim().slice(0, 200) || undefined;
    // 作者：只见于"…，由{作者}发布在腾讯频道…"，以逗号锚定避免误抓"自由/理由"等词
    const uploaderMatch = /(?:，|,\s*)由(.{2,30}?)(?:发布)/.exec(rawDescription);
    const uploader = uploaderMatch ? uploaderMatch[1].trim() : undefined;
    const cover = metaContent(html, "og:image", "property") || metaContent(html, "og:image:url", "property") || "";
    const shareId = /\/hs\/([0-9A-Za-z_-]+)/.exec(finalUrl)?.[1] || "";

    const format: VideoFormat = {
      formatId: "qq_share",
      ext: direct.includes(".m3u8") ? "m3u8" : "mp4",
      resolution: "原始",
      filesize: null,
      vcodec: "h264",
      acodec: "aac",
      hasAudio: true,
      label: "无水印 MP4 (QQ短视频)",
      url: direct,
    };

    return {
      id: shareId,
      title: title.slice(0, 200),
      description: description ? description.slice(0, 200) : undefined,
      thumbnail: cover,
      uploader: uploader || "QQ短视频用户",
      platform: "qq",
      directUrl: direct,
      formats: [format],
      subtitles: [],
      url: ctx.url,
    };
  },
};

export type { UniversalError };