import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractSubtitleWithCache } from "@/lib/subtitle-cache";
import { getAiSettings, buildExtractor } from "@/lib/ai-config";
import { segmentsToFormat, friendlyYtDlpError, type SubtitleFormat } from "@saveany/core";

/**
 * POST /api/subtitle — 提取字幕并导出（srt / vtt / txt）
 * 需登录
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: { url?: string; format?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const { url, format } = body;
  if (!url || typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "请提供视频链接" }, { status: 400 });
  }
  const fmt = (format === "srt" || format === "vtt" || format === "txt" ? format : "srt") as SubtitleFormat;

  try {
    const settings = await getAiSettings();
    const extractor = buildExtractor(settings);
    const sub = await extractSubtitleWithCache(extractor, url.trim());
    if (!sub.hasSubtitle || !sub.segments.length) {
      const reason =
        (sub as { error?: string }).error ||
        "未检测到可用的字幕或语音内容：视频可能没有语音（纯音乐/无人声），或平台未提供字幕且语音转写不可用。";
      return NextResponse.json({ error: reason }, { status: 404 });
    }
    return NextResponse.json({
      data: {
        language: sub.language,
        subtitleType: sub.subtitleType,
        format: fmt,
        content: segmentsToFormat(sub.segments, fmt),
      },
    });
  } catch (err) {
    const message = friendlyYtDlpError(err);
    console.error("subtitle", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}