/**
 * universal/http.ts — 通用网络器
 *
 * 把各平台重复的公共过程收敛到一处（模式取自 DouyinParser 的 CookieJar/重定向/HTML JSON 提取）：
 *  - CookieJar：跨请求保持 set-cookie（访客 cookie 常是拿到完整数据的开关）
 *  - 短链还原：manual 重定向逐跳收集 location 与 cookie
 *  - 内嵌 JSON 提取：`window.XXX = {...};` 花括号配对 → JSON.parse
 *  - 字段取值：`getByPath(obj, "a.b[0].c")`
 */
import { DESKTOP_UA, MOBILE_UA, sleep } from "../utils.js";

const URL_PATTERN = /https?:\/\/[^\s]+/i;

/** 从用户分享文案中提取首个链接 */
export function extractUrl(text: string): string {
  const match = URL_PATTERN.exec(text);
  if (!match) throw new Error("未找到有效的视频链接");
  return match[0].trim().replace(/^["']|["']$/g, "").replace(/[).,;!?]+$/, "");
}

/** 轻量 cookie jar */
export class CookieJar {
  private cookies = new Map<string, string>();

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  has(): boolean {
    return this.cookies.size > 0;
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clear(): void {
    this.cookies.clear();
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** 指纹：判断响应后 cookie 是否变化 */
  fingerprint(): string {
    return JSON.stringify([...this.cookies.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}

function collectCookies(resp: Response, jar: CookieJar): void {
  let setCookies: string[] = [];
  try {
    const list = (resp.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    if (list && list.length) setCookies = list;
  } catch {
    /* ignore */
  }
  if (!setCookies.length) {
    const raw = resp.headers.get("set-cookie");
    if (raw) setCookies = [raw];
  }
  for (const sc of setCookies) {
    const pair = sc.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name && value !== "deleted") jar.set(name, value);
    }
  }
}

export type UaMode = "desktop" | "mobile";

export interface UniversalHttpOptions {
  ua?: UaMode;
  /** 请求头中默认附加的 Referer 等 */
  defaultHeaders?: Record<string, string>;
  /** 重试次数（瞬时错误时指数退避重试），默认 3 */
  maxRetries?: number;
}

/** 通用网络器：CookieJar + 重定向 + JSON 提取 + 字段取值 */
export class UniversalHttp {
  readonly jar = new CookieJar();
  private readonly ua: string;
  private readonly baseHeaders: Record<string, string>;
  private readonly maxRetries: number;

  constructor(opts: UniversalHttpOptions = {}) {
    this.ua = opts.ua === "mobile" ? MOBILE_UA : DESKTOP_UA;
    this.baseHeaders = { "User-Agent": this.ua, ...opts.defaultHeaders };
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /** 原始请求：自动附带 cookie，响应后收集 set-cookie；redirect 默认 manual 由调用方处理 */
  async request(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const cookie = this.jar.header();
    const headers: Record<string, string> = { ...this.baseHeaders, ...(init.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    const resp = await fetch(url, { ...init, headers, redirect: init.redirect ?? "manual", signal: init.signal ?? AbortSignal.timeout(30_000) });
    collectCookies(resp, this.jar);
    return resp;
  }

  /** 自动跟随重定向（最多 10 跳），逐跳收集 cookie，返回最终 URL 与响应 */
  async autoRequest(
    url: string,
    init: RequestInit & { headers?: Record<string, string> } = {}
  ): Promise<{ url: string; response: Response }> {
    let current = url;
    for (let hop = 0; hop < 10; hop++) {
      const resp = await this.request(current, init);
      const location = resp.headers.get("location");
      if (resp.status >= 300 && resp.status < 400 && location) {
        current = new URL(location, resp.url).href;
        continue;
      }
      return { url: resp.url, response: resp };
    }
    throw new Error("重定向次数过多");
  }

  /** GET 并尝试 JSON.parse（多用于 API） */
  async getJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
    return this.withRetry(async () => {
      const { response } = await this.autoRequest(url, { headers, redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    }, `GET ${url}`);
  }

  /** POST（body 自动按 Content-Type 处理）并尝试 JSON.parse */
  async postJson<T = unknown>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    return this.withRetry(async () => {
      const { response } = await this.autoRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        redirect: "follow",
      });
      return (await response.json()) as T;
    }, `POST ${url}`);
  }

  /** GET 返回 HTML 文本 */
  async getHtml(url: string, headers: Record<string, string> = {}): Promise<string> {
    const { response } = await this.withRetry(async () => {
      const { response: r } = await this.autoRequest(url, { headers, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { response: r, url: r.url };
    }, `GET ${url}`);
    return await response.text();
  }

  /** 短链还原：跟随重定向返回最终 URL（不读 body） */
  async resolveFinal(url: string, headers: Record<string, string> = {}): Promise<string> {
    const { url: finalUrl } = await this.withRetry(
      () => this.autoRequest(url, { headers, redirect: "manual", method: "GET" }),
      `REDIRECT ${url}`
    );
    return finalUrl;
  }

  /** 带指数退避的重试包装 */
  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries - 1) await sleep(1000 * 2 ** attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${label} 失败`);
  }

  /**
   * 提取 `window.XXX = {...};` 形式的内嵌 JSON（花括号配对，兼容偶尔出现的裸 undefined）
   * @param marker 例如 "window.__INITIAL_STATE__" 或 "__NUXT__"
   * @param replaceUndefined 是否将 `: undefined` 替换为 `null`（小红书 SSR 会出现）
   */
  extractJsonByMarker(html: string, marker: string, opts: { replaceUndefined?: boolean } = {}): Record<string, unknown> | null {
    const start = html.indexOf(marker);
    if (start < 0) return null;

    // 跳过 marker 与等号
    let idx = start + marker.length;
    while (idx < html.length && /\s/.test(html[idx])) idx++;
    if (html[idx] === "=") {
      idx++;
      while (idx < html.length && /\s/.test(html[idx])) idx++;
    }

    // 形如 window.XXX = (function(){ return {...}; })(); 时直接找第一个 {
    const braceStart = html.indexOf("{", idx);
    if (braceStart < 0) return null;

    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let cursor = braceStart; cursor < html.length; cursor++) {
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
          let raw = html.slice(braceStart, cursor + 1);
          if (opts.replaceUndefined) {
            raw = raw.replace(/:\s*undefined([,\]}:])/g, ":null$1").replace(/,undefined/g, ",null");
          }
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /** 按路径取值：getByPath(obj, "note.video.media.stream.h264[0].masterUrl") */
  getByPath(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (let part of parts) {
      // 支持 a[0].b 与 a[0] 片段
      const arr = part.match(/^(.*?)\[(\d+)\]$/);
      if (arr) {
        part = arr[1];
        if (part) {
          if (cur && typeof cur === "object" && !Array.isArray(cur)) cur = (cur as Record<string, unknown>)[part];
          else return undefined;
        }
        if (!Array.isArray(cur)) return undefined;
        cur = cur[Number(arr[2])];
      } else {
        if (cur && typeof cur === "object" && !Array.isArray(cur)) {
          cur = (cur as Record<string, unknown>)[part];
        } else if (Array.isArray(cur) && part) {
          // 数组上遇到具名字段视为缺省
          return undefined;
        } else {
          return undefined;
        }
      }
    }
    return cur;
  }
}