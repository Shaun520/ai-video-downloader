import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SubtitleExtractor, VideoSummarizer, formatSse } from "@saveany/core";

export const dynamic = "force-dynamic";

/**
 * POST /api/mindmap — 生成思维导图（Markdown 一次性返回）
 * 需登录；同样需字幕
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: { url?: string; language?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const { url, language } = body;
  if (!url || typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "请提供视频链接" }, { status: 400 });
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
        const sub = await extractor.extract(url.trim());
        if (!sub.hasSubtitle || !sub.segments.length) {
          send("error", { message: "未找到可用字幕，无法生成思维导图" });
          controller.close();
          return;
        }

        const summarizer = new VideoSummarizer(process.env.DEEPSEEK_API_KEY!);
        send("status", { message: "AI 正在整理思维导图…" });
        const markdown = await summarizer.generateMindmap(sub.fullText, language || "zh");
        send("mindmap", { content: markdown });
        send("done", {});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("mindmap error:", message);
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