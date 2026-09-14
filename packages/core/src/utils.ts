/** 通用工具：文件名校验、时长/大小格式化、HTTP 头、sleep */

export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

export const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Referer: "https://www.douyin.com/",
};

export const MOBILE_HEADERS: Record<string, string> = {
  "User-Agent": MOBILE_UA,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.douyin.com/",
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 移除文件名非法字符 */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/*?:"<>|\x00-\x1f]/g, "_");
}

/** 字节数 → 人类可读大小 */
export function formatFilesize(size?: number | null): string {
  if (!size || size <= 0) return "未知大小";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/** 秒数 → 时长字符串 */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/** 幂等请求：带退避重试 */
export async function requestWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  maxRetries = 3
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
      try {
        const resp = await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries - 1) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("请求失败");
}