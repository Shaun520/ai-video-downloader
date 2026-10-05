/** 站点级 SEO 常量：统一域名与品牌信息，供 metadata / robots / sitemap / JSON-LD 复用 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://saviot.site"
).replace(/\/+$/, "");

export const SITE_NAME = "AI 视频下载器";

export const SITE_DESCRIPTION =
  "粘贴链接即可解析下载国内外主流平台视频；AI 一键生成内容总结、思维导图与字幕，无需安装任何软件。";
