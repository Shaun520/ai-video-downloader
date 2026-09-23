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