/**
 * settings.ts — 全站 AI 模型配置（app_settings 表）
 * admin 写入、web 运行时读取；任何读取失败/字段非法均回退默认值，
 * 保证迁移未执行或 DB 异常时业务照常可用。
 */
import type { Db } from "./client.js";
import { DEFAULT_AI_MODEL_SETTINGS, type AiModelSettings, type LlmProvider } from "@saveany/shared";

interface AppSettingRow {
  key: string;
  value: unknown;
}

const PROVIDERS: LlmProvider[] = ["deepseek", "dashscope"];

function isLlmProvider(v: unknown): v is LlmProvider {
  return typeof v === "string" && (PROVIDERS as string[]).includes(v);
}

/** 读取全站模型配置，非法/缺失字段回退默认值 */
export async function getAppSettings(db: Db): Promise<AiModelSettings> {
  const settings = { ...DEFAULT_AI_MODEL_SETTINGS };
  try {
    const { data } = await db.from("app_settings").select("key,value");
    const rows = (data ?? []) as AppSettingRow[];
    const provider = rows.find((r) => r.key === "llm.provider")?.value;
    if (isLlmProvider(provider)) settings.llm.provider = provider;
    const llmModel = rows.find((r) => r.key === "llm.model")?.value;
    if (typeof llmModel === "string" && llmModel.trim()) settings.llm.model = llmModel.trim();
    const asrModel = rows.find((r) => r.key === "asr.model")?.value;
    if (typeof asrModel === "string" && asrModel.trim()) settings.asr.model = asrModel.trim();
  } catch {
    // 读取失败时保持默认值
  }
  return settings;
}

/** 写入 / 更新单条配置（upsert） */
export async function setAppSetting(db: Db, key: string, value: unknown): Promise<void> {
  const { error } = await db
    .from("app_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(`保存模型配置失败: ${error.message}`);
}