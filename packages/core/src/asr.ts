/**
 * asr.ts — 语音识别
 * - 阿里云百炼 paraformer-v2：抖音等国内可达直链（大陆服务端可拉取）
 * - Azure Batch Transcription（境外区域）：TikTok/YouTube 等海外直链（大陆百炼拉不到）
 * 统一以公网可访问的音视频直链提交转写任务，轮询完成后拉取结果 JSON 解析为分段字幕。
 */
import { sleep } from "./utils.js";

const SUBMIT_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const TASK_URL_PREFIX = "https://dashscope.aliyuncs.com/api/v1/tasks/";

export type AsrSegment = { start: number; end: number; text: string };

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
): Promise<AsrSegment[]> {
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

  const segments: AsrSegment[] = [];
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

/* ------------------------------------------------------------------ */
/* Azure Batch Transcription（境外区域，用于海外平台的无字幕轨道）        */
/* ------------------------------------------------------------------ */

export interface AzureSpeechConfig {
  key: string;
  region: string;
  locale: string;
}

/** 解析 Azure 语音配置：key + region 齐备才启用；locale 默认 en-US（海外视频以英文为主） */
export function resolveAzureSpeechConfig(): AzureSpeechConfig | null {
  const key = (process.env.AZURE_SPEECH_KEY || "").trim();
  const region = (process.env.AZURE_SPEECH_REGION || "").trim();
  if (!key || !region) return null;
  return { key, region, locale: (process.env.AZURE_SPEECH_LOCALE || "en-US").trim() };
}

interface AzureCreateResponse {
  self?: string;
  status?: string;
}

interface AzureFileEntry {
  kind?: string;
  links?: { contentUrl?: string };
}

interface AzureTranscriptData {
  combinedRecognizedPhrases?: Array<{ display?: string }>;
  recognizedPhrases?: Array<{
    offsetInTicks?: number;
    durationInTicks?: number;
    offset?: number;
    duration?: number;
    nBest?: Array<{ display?: string; itn?: string; lexical?: string }>;
  }>;
}

/**
 * 用 Azure Batch Transcription 转写音视频直链（异步任务 + 轮询）。
 * Azure 服务端（境外区域）可拉取 googlevideo / tiktokcdn 等大陆不可达的直链。
 * @param fileUrl 公网可访问的音频/视频 URL（Azure 服务端会自行下载）
 * @returns 分段字幕；无语音时返回空数组
 */
export async function transcribeAzureFile(
  fileUrl: string,
  config: AzureSpeechConfig,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<AsrSegment[]> {
  const { timeoutMs = 300_000, pollIntervalMs = 5_000 } = opts;
  const base = `https://${config.region}.api.cognitive.microsoft.com/speechtotext/v3.1`;
  const headers = {
    "Ocp-Apim-Subscription-Key": config.key,
    "Content-Type": "application/json",
  };

  // 1) 创建转录任务（contentUrls 由 Azure 服务端拉取）
  const createRes = await fetch(`${base}/transcriptions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contentUrls: [fileUrl],
      properties: {
        diarizationEnabled: false,
        channelIdentification: false,
        punctuationMode: "DictatedAndAutomatic",
        profanityFilterMode: "Masked",
      },
      locale: config.locale,
      displayName: "saveany-transcription",
      timeToLiveHours: 48,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const created = (await createRes.json().catch(() => null)) as AzureCreateResponse | null;
  const self = created?.self?.trim();
  if (!createRes.ok || !self) {
    throw new Error(`Azure 转录任务创建失败: HTTP ${createRes.status} ${JSON.stringify(created).slice(0, 200)}`);
  }

  // 2) 轮询任务直至成功/失败
  const deadline = Date.now() + timeoutMs;
  let status = "NotStarted";
  let lastQuery: unknown = null;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const queryRes = await fetch(self, { headers, signal: AbortSignal.timeout(30_000) });
    const query = (await queryRes.json().catch(() => null)) as { status?: string } | null;
    lastQuery = query;
    status = query?.status || status;
    if (status === "Succeeded" || status === "Failed") break;
  }
  if (status !== "Succeeded") {
    const detail = JSON.stringify(lastQuery).slice(0, 400);
    throw status === "Failed"
      ? new Error(`Azure 转写失败: ${detail}`)
      : new Error(`Azure 转写超时: ${detail}`);
  }

  // 3) 拉取转写结果文件（kind=Transcription 的 JSON 内容）
  const filesRes = await fetch(`${self}/files`, { headers, signal: AbortSignal.timeout(30_000) });
  const files = (await filesRes.json().catch(() => null)) as { values?: AzureFileEntry[] } | null;
  const contentUrl = (files?.values || []).find((f) => f.kind === "Transcription" && f.links?.contentUrl)?.links?.contentUrl;
  if (!contentUrl) return [];

  const dataRes = await fetch(contentUrl, { signal: AbortSignal.timeout(30_000) });
  const data = (await dataRes.json().catch(() => null)) as AzureTranscriptData | null;

  // 4) 解析分段（Azure 时间单位：100ns tick）
  const segments: AsrSegment[] = [];
  for (const p of data?.recognizedPhrases || []) {
    const best = p.nBest?.find((nb) => (nb.display || nb.itn || nb.lexical || "").trim()) || p.nBest?.[0];
    const text = (best?.display || best?.itn || best?.lexical || "").trim();
    if (!text) continue;
    const startTick = p.offsetInTicks;
    const durTick = p.durationInTicks;
    const start = startTick != null ? startTick / 10_000_000 : round2(p.offset || 0);
    const end = durTick != null ? round2(start + durTick / 10_000_000) : start;
    segments.push({ start: round2(start), end, text });
  }

  // 兜底：无短语时间戳时用整段文本
  if (!segments.length) {
    const full = (data?.combinedRecognizedPhrases || [])
      .map((c) => (c.display || "").trim())
      .filter(Boolean)
      .join(" ");
    if (full) segments.push({ start: 0, end: 0, text: full });
  }
  return segments;
}