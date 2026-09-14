/**
 * subtitle-cache.ts — 字幕/转写结果缓存（Supabase video_transcripts 表）
 * 四个 AI 入口（总结/导图/问答/字幕）对同一视频只提取一次；
 * 正缓存（有字幕）7 天有效，负缓存（无字幕）1 天有效。
 */
import { createClient } from "@/lib/supabase/server";
import { CONTAINER_URL, fetchSubtitleFromContainer } from "@/lib/platform-client";
import { SubtitleExtractor } from "@saveany/core";

export interface CachedSubtitle {
  hasSubtitle: boolean;
  language: string;
  subtitleType: "manual" | "auto" | "none";
  segments: Array<{ start: number; end: number; text: string }>;
  fullText: string;
  /** 提取失败/不可用时的原因（仅本次请求透传，不写入缓存） */
  error?: string;
}

interface CacheRow {
  url: string;
  has_subtitle: boolean;
  language: string;
  subtitle_type: "manual" | "auto" | "none";
  segments: unknown;
  full_text: string;
  created_at: string;
}

const POSITIVE_TTL_MS = 7 * 24 * 3600 * 1000; // 有字幕：7 天
// 无字幕：15 分钟（提取失败/瞬时风控多为假阴性，避免锁死用户一整天；真无人声视频重试成本也很低）
const NEGATIVE_TTL_MS = 15 * 60 * 1000;

/** 读取缓存；命中且未过期返回字幕，否则 null */
export async function getCachedSubtitle(url: string): Promise<CachedSubtitle | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("video_transcripts")
    .select("*")
    .eq("url", url)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as CacheRow;
  const ttl = row.has_subtitle ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  if (Date.now() - new Date(row.created_at).getTime() > ttl) {
    await supabase.from("video_transcripts").delete().eq("url", url);
    return null;
  }
  return {
    hasSubtitle: row.has_subtitle,
    language: row.language,
    subtitleType: row.subtitle_type,
    segments: Array.isArray(row.segments) ? (row.segments as CachedSubtitle["segments"]) : [],
    fullText: row.full_text || "",
  };
}

/** 写入/刷新缓存（upsert，刷新 created_at 以续期 TTL） */
export async function saveCachedSubtitle(url: string, sub: CachedSubtitle): Promise<void> {
  const supabase = await createClient();
  await supabase.from("video_transcripts").upsert({
    url,
    has_subtitle: sub.hasSubtitle,
    language: sub.language,
    subtitle_type: sub.subtitleType,
    segments: sub.segments,
    full_text: sub.fullText,
    created_at: new Date().toISOString(),
  });
}

/** 带缓存的字幕提取：命中缓存直接返回；否则提取并写入缓存（含负缓存） */
export async function extractSubtitleWithCache(extractor: SubtitleExtractor, url: string): Promise<CachedSubtitle> {
  const cached = await getCachedSubtitle(url);
  if (cached) return cached;

  // 部署形态：配置了容器则转发（Workers 无子进程，yt-dlp 类平台必须在容器执行）
  const extracted = CONTAINER_URL
    ? await fetchSubtitleFromContainer(url)
    : await extractor.extract(url);

  const result: CachedSubtitle = {
    hasSubtitle: extracted.hasSubtitle,
    language: extracted.language,
    subtitleType: extracted.subtitleType,
    segments: extracted.segments,
    fullText: extracted.fullText,
    error: extracted.error, // 仅透传给本次请求，不写入缓存
  };
  // 缓存写入失败（如表尚未创建）不阻塞主流程，只是本次不缓存
  await saveCachedSubtitle(url, result).catch(() => {});
  return result;
}