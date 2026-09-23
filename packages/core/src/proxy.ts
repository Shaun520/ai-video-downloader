/**
 * proxy.ts — 出站代理分流判定（国内直连 / 海外走代理）
 *
 * 容器部署场景：国内站点直连，仅海外站点经 socks-bridge → Tailscale → 家里 Clash 出海。
 * 判定口径：命中国内白名单或 .cn 顶级域 → 直连（不走代理）；
 * 其余一律视为海外站点 → 使用出站代理。
 * 未收录的国内站点可用环境变量 DOMESTIC_DIRECT_HOSTS（逗号分隔）追加。
 */

/** 国内平台/直连域后缀白名单（页面/接口 + 常见封面 CDN） */
export const DOMESTIC_HOST_SUFFIXES: readonly string[] = [
  // 平台页面/接口
  "bilibili.com",
  "b23.tv",
  "douyin.com",
  "ixigua.com",
  "weibo.com",
  "weibo.cn",
  "kuaishou.com",
  "xiaohongshu.com",
  "xhslink.com",
  "qq.com",
  "weixin.qq.com",
  "youku.com",
  "tudou.com",
  "iqiyi.com",
  "71.am",
  "sohu.com",
  "163.com",
  // 封面/CDN
  "hdslb.com",
  "douyinpic.com",
  "douyinstatic.com",
  "yximgs.com",
  "weibocdn.com",
  "sinaimg.cn",
];

/** 判定目标 host 是否国内站点（白名单后缀匹配 / .cn 顶级域） */
export function isDomesticHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host.endsWith(".cn")) return true;

  const extra = (process.env.DOMESTIC_DIRECT_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const suffixes = [...DOMESTIC_HOST_SUFFIXES, ...extra];
  return suffixes.some((s) => host === s || host.endsWith("." + s));
}

/** 按 URL 判定目标站点是否国内（直连）；URL 非法时按非国内处理 */
export function isDomesticUrl(url: string): boolean {
  try {
    return isDomesticHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 解析出站代理：显式 PROXY_URL 优先，其次 HTTPS_PROXY / HTTP_PROXY 环境变量 */
export function resolveOutboundProxy(): string | undefined {
  const p = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  return p && p.trim() ? p.trim() : undefined;
}

/**
 * 按目标 URL 分流：国内 → undefined（直连，不传 --proxy）；海外 → 出站代理。
 */
export function resolveProxyForUrl(url: string): string | undefined {
  if (isDomesticUrl(url)) return undefined;
  return resolveOutboundProxy();
}

/** 常见浏览器 UA（短链展开 / 302 跟随时的请求头） */
const EXPAND_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/**
 * b23.tv 短链预展开：跟随 302 得到完整 bilibili.com/video/BV... 链接。
 * 原因：yt-dlp 对 b23.tv 走 [generic] 通用提取器，抓 B 站页易被反爬 412/超时；
 * 展开成 bilibili.com 完整链接后走 [BiliBili] 专用提取器，解析稳定。
 * 展开失败（网络不可达等）时原样返回，交给 yt-dlp 兜底，不改变现有行为。
 */
export async function expandDomesticShortUrl(url: string): Promise<string> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  // 仅处理 B 站短链；其余短链（v.douyin.com 等）由对应提取器自行跟进
  if (host !== "b23.tv" && !host.endsWith(".b23.tv")) return url;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": EXPAND_UA },
      });
    } finally {
      clearTimeout(timer);
    }
    let finalUrl = res.url || url;
    try {
      finalUrl = finalUrl.replace(/^http:/i, "https:");
      if (new URL(finalUrl).hostname.endsWith("bilibili.com")) {
        const u = new URL(finalUrl);
        u.search = ""; // 去掉分享埋点参数，保持干净
        return u.href;
      }
    } catch {
      /* 最终地址非法则回退原链接 */
    }
  } catch {
    /* 短链展开失败：回退原链接，交 yt-dlp 兜底 */
  }
  return url;
}