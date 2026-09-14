/**
 * summarize.ts — LLM 大模型调用（DeepSeek 官方 / 阿里云百炼 DashScope，兼容 OpenAI 协议，流式 SSE）
 * 对应 backend/summarizer.py 的 VideoSummarizer。
 */
import type { SubtitleSegment } from "./subtitle.js";
import type { LlmConfig, LlmProvider } from "@saveany/shared";

const BASE_URLS: Record<LlmProvider, string> = {
  deepseek: "https://api.deepseek.com/chat/completions",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
};

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class VideoSummarizer {
  constructor(private apiKey: string, private cfg: LlmConfig) {
    if (!apiKey) throw new Error("缺少 LLM API Key（DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）");
  }

  private async createChatCompletion(messages: ChatMessage[], opts: { stream: true; temperature?: number; maxTokens?: number })
    : Promise<ReadableStream<Uint8Array>>;
  private async createChatCompletion(messages: ChatMessage[], opts: { stream: false; temperature?: number; maxTokens?: number })
    : Promise<string>;
  private async createChatCompletion(
    messages: ChatMessage[],
    opts: { stream: boolean; temperature?: number; maxTokens?: number }
  ): Promise<ReadableStream<Uint8Array> | string> {
    const body = {
      model: this.cfg.model,
      messages,
      stream: opts.stream,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);
    try {
      const resp = await fetch(BASE_URLS[this.cfg.provider], {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`DeepSeek API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      if (!opts.stream) {
        const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return json.choices?.[0]?.message?.content ?? "";
      }
      if (!resp.body) throw new Error("DeepSeek 无响应流");
      return resp.body;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 解析 DeepSeek SSE 流，逐 token yield 文本 */
  private async *iterText(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = json.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // 忽略无法解析的分片
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** 流式生成视频总结 */
  summarizeStream(subtitleText: string, language = "zh"): AsyncGenerator<string> {
    const prompt = buildSummaryPrompt(subtitleText, language);
    const streamPromise = this.createChatCompletion(
      [
        { role: "system", content: "你是一个专业的视频内容分析助手，擅长提取关键信息并生成结构化的总结。" },
        { role: "user", content: prompt },
      ],
      { stream: true, temperature: 0.7, maxTokens: 4096 }
    );
    return this.toGenerator(streamPromise);
  }

  /** 生成思维导图 Markdown（一次性返回） */
  async generateMindmap(subtitleText: string, language = "zh"): Promise<string> {
    const prompt = buildMindmapPrompt(subtitleText, language);
    return this.createChatCompletion(
      [
        { role: "system", content: "你是一个专业的思维导图生成助手，擅长将内容组织为清晰的层级结构。" },
        { role: "user", content: prompt },
      ],
      { stream: false, temperature: 0.5, maxTokens: 4096 }
    );
  }

  /** 流式 AI 问答 */
  chatStream(subtitleText: string, question: string): AsyncGenerator<string> {
    const prompt = buildChatPrompt(subtitleText, question);
    const streamPromise = this.createChatCompletion(
      [
        { role: "system", content: "你是一个视频内容问答助手。根据提供的视频字幕内容来回答用户的问题。如果问题超出视频内容范围，请诚实告知。" },
        { role: "user", content: prompt },
      ],
      { stream: true, temperature: 0.7, maxTokens: 2048 }
    );
    return this.toGenerator(streamPromise);
  }

  private async *toGenerator(promise: Promise<ReadableStream<Uint8Array>>): AsyncGenerator<string> {
    const stream = await promise;
    yield* this.iterText(stream);
  }
}

function buildSummaryPrompt(subtitleText: string, language: string): string {
  const truncated = subtitleText.slice(0, 15000);
  const langHint = language.startsWith("zh") ? "中文" : "与原文相同的语言";
  return `请对以下视频字幕内容进行深度总结分析，使用${langHint}输出。

要求输出格式：
## 视频概述
（用2-3句话概括视频的主题和核心内容）

## 内容大纲
（按视频内容的逻辑顺序，列出主要章节/段落，每个章节包含要点）

## 核心知识要点
（提取视频中最重要的知识点、观点或结论，用编号列表形式）

## 总结
（用1-2句话给出整体评价或一句话总结）

---
视频字幕内容：
${truncated}`;
}

function buildMindmapPrompt(subtitleText: string, language: string): string {
  const truncated = subtitleText.slice(0, 15000);
  const langHint = language.startsWith("zh") ? "中文" : "与原文相同的语言";
  return `请将以下视频字幕内容整理为思维导图结构，使用${langHint}输出。

要求：
1. 使用 Markdown 标题层级格式（# 一级标题，## 二级标题，### 三级标题）
2. 最外层是视频主题
3. 第二层是主要章节/模块
4. 第三层是各章节的要点
5. 可以有第四层做更细的展开
6. 每个节点的文字要简洁精炼
7. 只输出 Markdown 内容，不要其他说明文字

---
视频字幕内容：
${truncated}`;
}

function buildChatPrompt(subtitleText: string, question: string): string {
  const truncated = subtitleText.slice(0, 12000);
  return `以下是一个视频的字幕内容，请根据这些内容回答用户的问题。

视频字幕内容：
${truncated}

---
用户问题：${question}

请基于视频内容给出准确、详细的回答。如果视频内容中没有相关信息，请诚实说明。`;
}

/** 由字幕分段拼出完整文本（供 chat 复用） */
export function segmentsToFullText(segments: SubtitleSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}