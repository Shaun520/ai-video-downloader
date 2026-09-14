import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SubtitleExtractor, segmentsToFormat, type SubtitleFormat } from "@saveany/core";

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
    const extractor = new SubtitleExtractor();
    const sub = await extractor.extract(url.trim());
    if (!sub.hasSubtitle || !sub.segments.length) {
      return NextResponse.json({ error: "未找到可用字幕" }, { status: 404 });
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
    const message = err instanceof Error ? err.message : "字幕提取失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}