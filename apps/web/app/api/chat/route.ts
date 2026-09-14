import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractSubtitleWithCache } from "@/lib/subtitle-cache";
import { SubtitleExtractor, VideoSummarizer, formatSse } from "@saveany/core";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat — AI 问答（SSE 流式）
 * 需登录；基于视频字幕回答用户问题（不扣减总结额度）
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: { url?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const { url, question } = body;
  if (!url || typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "请提供视频链接" }, { status: 400 });
  }
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(formatSse(event, JSON.stringify(data))));
      };
      try {
        const extractor = new SubtitleExtractor();
        send("status", { message: "正在提取视频字幕…" });
        const sub = await extractSubtitleWithCache(extractor, url.trim());
        if (!sub.hasSubtitle || !sub.segments.length) {
          send("error", { message: "未找到可用字幕，无法回答问题" });
          controller.close();
          return;
        }

        const summarizer = new VideoSummarizer(process.env.DEEPSEEK_API_KEY!);
        send("status", { message: "AI 正在回答…" });
        for await (const chunk of summarizer.chatStream(sub.fullText, question.trim())) {
          send("text", { content: chunk });
        }
        send("done", {});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("chat error:", message);
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}