/**
 * universal/types.ts — 统一解析框架类型定义
 *
 * 平台差异用「声明式策略」表达：每个平台只写“识别 + 提取/mapping”逻辑，
 * 公共过程（重定向、CookieJar、内嵌 JSON 提取、字段取值）由 universal/http.ts 统一提供。
 */
import type { VideoInfo } from "@saveany/shared";
import type { UaMode, UniversalHttp } from "./http.js";

/** 错误分类（与 yt-dlp 侧 YtDlpErrorKind 对齐，便于路由层统一中文提示） */
export type UniversalErrorKind =
  | "network" // 连不上目标平台
  | "anti_bot" // 平台风控
  | "needs_login" // 需要登录/凭证
  | "not_found" // 内容不存在/已删除
  | "unsupported" // 链接不在支持范围
  | "unknown";

/** 统一框架错误：携带分类，路由层据此输出与现有 YTDLP_ERROR_HINTS 一致的中文文案 */
export class UniversalError extends Error {
  readonly kind: UniversalErrorKind;

  constructor(kind: UniversalErrorKind, message: string) {
    super(message);
    this.name = "UniversalError";
    this.kind = kind;
  }
}

/** 策略执行上下文：提供通用网络器与工具，策略只写业务提取逻辑 */
export interface StrategyContext {
  /** 本次解析共用的网络器（含 CookieJar / 重定向 / JSON 提取） */
  http: UniversalHttp;
  /** 用户原始输入链接 */
  url: string;
  /** 从用户分享文案中提取首个链接 */
  extractUrl(text: string): string;
}

/** 平台策略契约（声明式） */
export interface PlatformStrategy {
  /** 策略 id，同时作为 VideoInfo.platform 值（对应 PLATFORM_NAMES 键） */
  id: string;
  label: string;
  /** 按初始 URL host 识别（短链域名即可命中，无需先重定向） */
  match(host: string): boolean;
  /** 解析：返回统一媒体描述 + 无水印直链格式 */
  resolve(ctx: StrategyContext): Promise<VideoInfo>;
  /** 下载直链时需要的 Referer（防止 CDN 403） */
  referer: string;
  /** 整个策略用到的 UA 形态（默认 desktop；快手等反爬平台用 mobile） */
  ua?: UaMode;
}