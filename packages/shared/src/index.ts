/**
 * packages/shared — 全站共享类型与常量
 * 供 apps/web、apps/admin、packages/core 复用
 */

/** 平台枚举：AI 总结支持的来源 */
export type VideoPlatform = "youtube" | "bilibili" | "douyin" | string;

/** 视频格式（yt-dlp format） */
export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution?: string;
  height?: number;
  fps?: number;
  filesize?: number | null;
  filesizeApprox?: number | null;
  vcodec?: string;
  acodec?: string | null;
  /** 是否含音频（false 表示仅视频） */
  hasAudio: boolean;
  label: string;
  url?: string;
}

/** 字幕轨道 */
export interface SubtitleTrack {
  language: string;
  name?: string;
  /** 自动生成的字幕 */
  auto: boolean;
  url?: string;
  /** 已下载的内容（vtt/srt 文本） */
  content?: string;
}

/** 解析后的视频信息 */
export interface VideoInfo {
  id?: string;
  title: string;
  description?: string;
  thumbnail?: string;
  /** 时长（秒） */
  duration?: number;
  uploader?: string;
  uploaderId?: string;
  viewCount?: number;
  uploadDate?: string;
  platform: string;
  /** 源站直链（带宽友好优先） */
  directUrl?: string;
  formats: VideoFormat[];
  subtitles?: SubtitleTrack[];
  url: string;
}

/** 下载结果 */
export interface DownloadResult {
  url: string;
  filename: string;
  /** 下载方式：direct 直链 | proxied 中转流式 */
  mode: "direct" | "proxied";
  mimeType?: string;
  size?: number;
}

/** AI 总结 SSE 事件 */
export type SummaryEvent =
  | { type: "start"; jobId: string }
  | { type: "text"; content: string }
  | { type: "mindmap"; content: string }
  | { type: "subtitle"; content: string; format: "srt" | "vtt" | "txt" }
  | { type: "done"; summary?: string }
  | { type: "error"; message: string };

/** 用户（Supabase Auth users + 业务字段） */
export interface UserProfile {
  id: string;
  email: string;
  isVip: boolean;
  vipExpireAt?: string;
  dailySummaryCount: number;
  lastSummaryDate?: string;
  createdAt: string;
}

/** 订单 */
export type OrderStatus = "pending" | "paid" | "canceled" | "refunded";
export type PlanType = "monthly" | "yearly";

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  planType: PlanType;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  paidAt?: string;
  createdAt: string;
}

/** 每日免费限制 */
export const FREE_DAILY_SUMMARY_LIMIT = 3;

/** VIP 生效校验结果 */
export type SummaryQuota = { allowed: boolean; remaining: number };

/** 常量 */
export const PLATFORM_NAMES: Record<string, string> = {
  youtube: "YouTube",
  bilibili: "哔哩哔哩",
  douyin: "抖音",
  tiktok: "TikTok",
};

/** LLM 服务通道：DeepSeek 官方 | 阿里云百炼 DashScope */
export type LlmProvider = "deepseek" | "dashscope";

/** LLM 配置（视频总结 / 思维导图 / AI 问答共用） */
export interface LlmConfig {
  provider: LlmProvider;
  model: string;
}

/** ASR 语音转写配置（抖音自动字幕） */
export interface AsrConfig {
  model: string;
}

/** 全站 AI 模型配置 */
export interface AiModelSettings {
  llm: LlmConfig;
  asr: AsrConfig;
}

/** 默认模型配置（DB 缺失或读取失败时兜底） */
export const DEFAULT_AI_MODEL_SETTINGS: AiModelSettings = {
  llm: { provider: "deepseek", model: "deepseek-chat" },
  asr: { model: "paraformer-v2" },
};