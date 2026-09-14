import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractSubtitleWithCache } from "@/lib/subtitle-cache";
import { getAiSettings, buildSummarizer, buildExtractor } from "@/lib/ai-config";
// （临时注释）每日免费次数配额：恢复时取消注释本行 import 与下方配额代码块
// import { getSupabaseEnv, createAdminClient, checkAndIncrementSummary } from "@saveany/db";
import { sseStream, formatSse } from "@saveany/core";

export const dynamic = "force-dynamic";

/**
 * POST /api/summarize — AI 视频总结（SSE 流式）
 * 步骤：鉴权 → 配额检查（自动扣减）→ 提取字幕 → DeepSeek 流式返回
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

  // （临时注释）配额检查（含扣减）：测试期间不限制免费次数，恢复时取消注释以下代码块
  // const env = getSupabaseEnv();
  // const admin = createAdminClient(env);
  // const quota = await checkAndIncrementSummary(admin, user.id);
  // if (!quota.allowed) {
  //   return NextResponse.json(
  //     { error: quota.message || "今日额度已用完" },
  //     { status: 403 }
  //   );
  // }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(formatSse(event, JSON.stringify(data))));
      };
      try {
        const settings = await getAiSettings();
        const extractor = buildExtractor(settings);
        send("status", { step: "subtitle", message: "正在提取视频字幕…" });
        const sub = await extractSubtitleWithCache(extractor, url.trim());
        if (!sub.hasSubtitle || !sub.segments.length) {
          const reason =
            sub.error || "未检测到可用的字幕或语音内容：视频可能没有语音（纯音乐/无人声），或平台未提供字幕且语音转写不可用。";
          send("error", { message: `无法进行 AI 总结：${reason}` });
          controller.close();
          return;
        }
        send("subtitle", {
          language: sub.language,
          subtitleType: sub.subtitleType,
          hasSubtitle: sub.hasSubtitle,
          segmentCount: sub.segments.length,
          fullText: sub.fullText,
          segments: sub.segments,
        });

        const summarizer = buildSummarizer(settings);
        send("status", { step: "summarize", message: "AI 正在生成总结…" });
        let summary = "";
        for await (const chunk of summarizer.summarizeStream(sub.fullText, language || "zh")) {
          summary += chunk;
          send("text", { content: chunk });
        }
        send("done", { summary });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("summarize error:", message);
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