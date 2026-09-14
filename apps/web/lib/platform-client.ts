/**
 * platform-client.ts — Worker 侧核心能力客户端
 *
 * Cloudflare Workers 无法运行子进程（yt-dlp/ffmpeg），需要解析/字幕等核心
 * 能力时，若配置了 CONTAINER_URL（Cloudflare Containers 服务），统一转发到
 * 容器执行；未配置则回落到本机直接执行（开发模式）。
 */
import type { SubtitleResult } from "@saveany/core";

export const CONTAINER_URL = (process.env.CONTAINER_URL || "").trim();

/** 调用容器服务；网络不可达/业务错误统一转为中文友好提示抛出 */
export async function callContainer<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  if (!CONTAINER_URL) throw new Error("未配置 CONTAINER_URL");
  let res: Response;
  try {
    res = await fetch(`${CONTAINER_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error("核心服务（容器）不可达，请检查部署配置");
  }
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    detail?: string;
    data?: unknown;
  };
  if (!res.ok) {
    throw new Error(payload.error || "核心服务处理失败");
  }
  return (payload.data ?? payload) as T;
}

/** 通过容器提取字幕（返回与 SubtitleExtractor.extract 一致的结构） */
export async function fetchSubtitleFromContainer(url: string, asrModel?: string): Promise<SubtitleResult> {
  return callContainer<SubtitleResult>("/subtitle", { url, ...(asrModel ? { asr_model: asrModel } : {}) });
}