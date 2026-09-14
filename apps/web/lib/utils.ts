/** 前端通用工具 */

/** 组合 className（过滤 falsy） */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** 数字 → 万/亿 */
export function formatCount(n?: number | null): string {
  if (!n || n <= 0) return "";
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toLocaleString();
}

/** 秒 → 时长字符串 */
export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 平台英文 key → 中文名（后端可能直接返回英文 extractor） */
export function platformName(key: string | undefined): string {
  if (!key) return "视频";
  const k = key.toLowerCase();
  if (k.includes("youtube")) return "YouTube";
  if (k.includes("bilibili")) return "哔哩哔哩";
  if (k.includes("douyin")) return "抖音";
  if (k.includes("tiktok")) return "TikTok";
  if (k.includes("twitter") || k.includes("x.com")) return "X(Twitter)";
  if (k.includes("weibo")) return "微博";
  if (k.includes("xiaohongshu") || k.includes("rednote")) return "小红书";
  return key;
}