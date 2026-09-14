/**
 * asr.ts — 语音识别（阿里云百炼 paraformer-v2）
 * 用于抖音等无字幕轨道的视频：以公网可访问的音视频直链提交转写任务，
 * 轮询至完成后拉取结果 JSON 解析为分段字幕。
 */
import { sleep } from "./utils.js";

const SUBMIT_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const TASK_URL_PREFIX = "https://dashscope.aliyuncs.com/api/v1/tasks/";

export const DEFAULT_DASHSCOPE_MODEL = "paraformer-v2";

interface TranscriptionResult {
  transcripts?: Array<{
    text?: string;
    sentences?: Array<{ begin_time?: number; end_time?: number; text?: string }>;
  }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface TaskQueryResponse {
  output?: {
    task_status?: string;
    results?: Array<{ transcription_url?: string }>;
  };
}

/**
 * 用阿里云百炼 Paraformer 转写音视频文件。
 * @param fileUrl 公网可访问的音频/视频 URL（服务端会自行下载）
 * @param apiKey 百炼 DASHSCOPE_API_KEY
 * @returns 分段字幕（毫秒时间戳转为秒）；无语音时返回空数组
 */
export async function transcribeAudioFile(
  fileUrl: string,
  apiKey: string,
  opts: { model?: string; timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<Array<{ start: number; end: number; text: string }>> {
  const { model = DEFAULT_DASHSCOPE_MODEL, timeoutMs = 180_000, pollIntervalMs = 2_000 } = opts;

  // 1) 提交异步转写任务
  const submit = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model,
      input: { file_urls: [fileUrl] },
      parameters: { language_hints: ["zh", "en"] },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const submitJson = (await submit.json().catch(() => null)) as { output?: { task_id?: string } } | null;
  const taskId = submitJson?.output?.task_id;
  if (!submit.ok || !taskId) {
    throw new Error(`ASR 任务提交失败: ${JSON.stringify(submitJson).slice(0, 200)}`);
  }

  // 2) 轮询任务直至完成
  const deadline = Date.now() + timeoutMs;
  let result: TaskQueryResponse | null = null;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const query = await fetch(`${TASK_URL_PREFIX}${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const q = (await query.json().catch(() => null)) as TaskQueryResponse | null;
    const status = q?.output?.task_status;
    if (status === "SUCCEEDED") {
      result = q;
      break;
    }
    if (status === "FAILED") {
      throw new Error(`ASR 转写失败: ${JSON.stringify(q).slice(0, 200)}`);
    }
  }
  if (!result) throw new Error("ASR 转写超时");

  // 3) 拉取结果 JSON，解析分段字幕
  const transcriptionUrl = result.output?.results?.[0]?.transcription_url;
  if (!transcriptionUrl) return [];

  const resp = await fetch(transcriptionUrl, { signal: AbortSignal.timeout(30_000) });
  const data = (await resp.json().catch(() => null)) as TranscriptionResult | null;

  const segments: Array<{ start: number; end: number; text: string }> = [];
  for (const t of data?.transcripts || []) {
    for (const s of t.sentences || []) {
      const text = (s.text || "").trim();
      if (!text) continue;
      segments.push({ start: round2((s.begin_time || 0) / 1000), end: round2((s.end_time || 0) / 1000), text });
    }
  }

  // 兜底：无句子级时间戳时用整段文本
  if (!segments.length) {
    const full = (data?.transcripts || [])
      .map((t) => (t.text || "").trim())
      .filter(Boolean)
      .join(" ");
    if (full) segments.push({ start: 0, end: 0, text: full });
  }
  return segments;
}