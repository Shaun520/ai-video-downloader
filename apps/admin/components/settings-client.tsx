"use client";

import { useState } from "react";
import type { AiModelSettings, AsrProvider, LlmProvider } from "@saveany/shared";
import { cn } from "@/lib/utils";
import { SpinnerIcon } from "@/lib/icons";

const PROVIDER_OPTIONS: { value: LlmProvider; label: string; keyHint: string }[] = [
  { value: "deepseek", label: "DeepSeek 官方", keyHint: "DEEPSEEK_API_KEY" },
  { value: "dashscope", label: "阿里云百炼 DashScope", keyHint: "DASHSCOPE_API_KEY" },
];

const MODEL_PRESETS: Record<LlmProvider, string[]> = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  dashscope: ["deepseek-v4.1-flash", "deepseek-v4-flash-0731", "qwen3.7-flash-2026-07-15"],
};

const ASR_MODELS = ["paraformer-v2", "paraformer-v1"];

/** ASR 后端：auto = 自动（环境变量有 AZURE_SPEECH_KEY 走 Azure，否则百炼） */
type AsrMode = "auto" | AsrProvider;

const ASR_PROVIDER_OPTIONS: { value: AsrMode; label: string; hint: string }[] = [
  { value: "auto", label: "自动", hint: "按部署环境自动选择" },
  { value: "dashscope", label: "阿里云百炼", hint: "国内直链（抖音等）" },
  { value: "azure", label: "Azure 语音", hint: "境外区域（TikTok/YouTube）" },
];

export function SettingsClient({ initial }: { initial: AiModelSettings }) {
  const [provider, setProvider] = useState<LlmProvider>(initial.llm.provider);
  const [model, setModel] = useState(initial.llm.model);
  const [asrModel, setAsrModel] = useState(initial.asr.model);
  const [asrMode, setAsrMode] = useState<AsrMode>(initial.asr.provider ?? "auto");
  const [azureRegion, setAzureRegion] = useState(initial.asr.azureRegion ?? "koreacentral");
  const [azureLocale, setAzureLocale] = useState(initial.asr.azureLocale ?? "zh-CN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (!model.trim()) throw new Error("LLM 模型名不能为空");
      if (!asrModel.trim()) throw new Error("ASR 模型名不能为空");
      if (!azureRegion.trim()) throw new Error("Azure 区域不能为空");
      if (!azureLocale.trim()) throw new Error("Azure 语种不能为空");
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm: { provider, model: model.trim() },
          asr: {
            model: asrModel.trim(),
            // auto 不落库：读取时回退"自动"语义
            ...(asrMode === "auto" ? {} : { provider: asrMode }),
            azureRegion: azureRegion.trim(),
            azureLocale: azureLocale.trim(),
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "保存失败");
      setNotice("模型配置已保存，立即生效");
      setTimeout(() => setNotice(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const activeKeyHint = PROVIDER_OPTIONS.find((p) => p.value === provider)?.keyHint;
  const showDashscopeModel = asrMode !== "azure";
  const showAzureFields = asrMode !== "dashscope";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {notice && (
        <p className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">{notice}</p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {/* LLM 大模型 */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-text-primary">LLM 大模型</h2>
        <p className="mt-1 text-xs text-text-muted">用于视频总结、思维导图、AI 问答</p>

        <div className="mt-4">
          <p className="mb-1.5 text-[13px] font-medium text-text-secondary">服务通道</p>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setProvider(opt.value);
                  setModel(MODEL_PRESETS[opt.value][0]);
                }}
                aria-pressed={provider === opt.value}
                className={cn(
                  "h-11 rounded-lg border border-border text-[13px] text-text-secondary transition-colors",
                  provider === opt.value
                    ? "border-primary bg-primary-light text-primary"
                    : "hover:bg-border-light"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            对应 API Key 环境变量：<span className="font-mono">{activeKeyHint}</span>（若已切换到 DashScope，
            需确保已配置 DASHSCOPE_API_KEY）
          </p>
        </div>

        <div className="mt-4">
          <label htmlFor="llm-model" className="mb-1.5 block text-[13px] font-medium text-text-secondary">
            模型名称
          </label>
          <input
            id="llm-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="如 deepseek-chat 或 qwen3.7-flash-2026-07-15"
            className="h-10 w-full rounded-lg border border-border bg-white px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">快捷选项：</span>
            {MODEL_PRESETS[provider].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
                  model === m
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border text-text-secondary hover:bg-border-light"
                )}
              >
                {m}
              </button>
            ))}
            <span className="text-xs text-text-muted">（模型列表随服务方更新，可在输入框手动输入其它模型）</span>
          </div>
        </div>
      </section>

      {/* ASR 语音转写 */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-text-primary">ASR 语音转写</h2>
        <p className="mt-1 text-xs text-text-muted">
          用于无字幕视频的自动字幕（如抖音、TikTok）。国内直链走百炼，海外平台音频直链走 Azure 语音
        </p>

        <div className="mt-4">
          <p className="mb-1.5 text-[13px] font-medium text-text-secondary">转写后端</p>
          <div className="grid grid-cols-3 gap-2">
            {ASR_PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAsrMode(opt.value)}
                aria-pressed={asrMode === opt.value}
                className={cn(
                  "h-11 rounded-lg border border-border text-[13px] text-text-secondary transition-colors",
                  asrMode === opt.value
                    ? "border-primary bg-primary-light text-primary"
                    : "hover:bg-border-light"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            {ASR_PROVIDER_OPTIONS.find((o) => o.value === asrMode)?.hint}，且 Key 均来自环境变量
            （<span className="font-mono">DASHSCOPE_API_KEY</span> / <span className="font-mono">AZURE_SPEECH_KEY</span>）
          </p>
        </div>

        {showDashscopeModel && (
          <div className="mt-4">
            <p className="mb-1.5 text-[13px] font-medium text-text-secondary">百炼模型</p>
            <div className="grid grid-cols-2 gap-2">
              {ASR_MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAsrModel(m)}
                  aria-pressed={asrModel === m}
                  className={cn(
                    "h-11 rounded-lg border border-border font-mono text-[13px] text-text-secondary transition-colors",
                    asrModel === m
                      ? "border-primary bg-primary-light text-primary"
                      : "hover:bg-border-light"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {showAzureFields && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="asr-azure-region" className="mb-1.5 block text-[13px] font-medium text-text-secondary">
                Azure 区域
              </label>
              <input
                id="asr-azure-region"
                value={azureRegion}
                onChange={(e) => setAzureRegion(e.target.value)}
                placeholder="如 koreacentral / eastus / southeastasia"
                className="h-10 w-full rounded-lg border border-border bg-white px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label htmlFor="asr-azure-locale" className="mb-1.5 block text-[13px] font-medium text-text-secondary">
                Azure 语种
              </label>
              <input
                id="asr-azure-locale"
                value={azureLocale}
                onChange={(e) => setAzureLocale(e.target.value)}
                placeholder="如 zh-CN / en-US"
                className="h-10 w-full rounded-lg border border-border bg-white px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-6 text-[13px] font-medium text-white hover:bg-primary-dark disabled:opacity-60"
        >
          {saving && <SpinnerIcon width={14} height={14} />}
          保存配置
        </button>
      </div>
    </div>
  );
}