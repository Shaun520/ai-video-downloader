/**
 * ai-config.ts — 运行时读取 AI 模型配置并构建服务实例
 * 配置由 admin 后台写入 Supabase app_settings 表；API Key 仍来自环境变量。
 */
import { getSupabaseEnv, createAdminClient, getAppSettings } from "@saveany/db";
import { VideoSummarizer, SubtitleExtractor } from "@saveany/core";
import type { AiModelSettings } from "@saveany/shared";

/** 读取全站 AI 模型配置（DB 异常时自动回退默认值） */
export async function getAiSettings(): Promise<AiModelSettings> {
  return getAppSettings(createAdminClient(getSupabaseEnv()));
}

/** 构建 LLM 总结器（Key 按 provider 映射环境变量） */
export function buildSummarizer(settings: AiModelSettings): VideoSummarizer {
  const llmApiKey =
    settings.llm.provider === "dashscope"
      ? process.env.DASHSCOPE_API_KEY
      : process.env.DEEPSEEK_API_KEY;
  return new VideoSummarizer(llmApiKey ?? "", settings.llm);
}

/** 构建字幕提取器（注入 ASR 模型与后端选择；Azure 区域/语种由 admin 可配置） */
export function buildExtractor(settings: AiModelSettings): SubtitleExtractor {
  return new SubtitleExtractor({
    asrModel: settings.asr.model,
    asrProvider: settings.asr.provider,
    azureRegion: settings.asr.azureRegion,
    azureLocale: settings.asr.azureLocale,
  });
}