"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoInfo } from "@saveany/shared";
import { formatDuration, formatCount, platformName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { DownloadIcon, LinkIcon, SpinnerIcon } from "./icons";

/** 解析 API 调用 */
export async function parseApi(url: string): Promise<VideoInfo> {
  const res = await fetch("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || "解析失败，请检查链接");
  }
  return json.data as VideoInfo;
}

/** 直链解析 */
export async function directUrlApi(url: string, formatId: string) {
  const res = await fetch("/api/direct-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, format_id: formatId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "获取直链失败");
  return json.data as { directUrl: string; ext: string; title: string };
}

interface ParseBoxProps {
  compact?: boolean;
  loading?: boolean;
  onParsed: (info: VideoInfo) => void;
  onError: (msg: string) => void;
  onLoadingChange: (loading: boolean) => void;
}

const EXAMPLES = [
  { label: "YouTube", url: "https://www.youtube.com/watch?v=aJOTlE1K90k" },
  { label: "哔哩哔哩", url: "https://www.bilibili.com/video/BV1GJ411x7h7" },
  { label: "抖音", url: "https://v.douyin.com/test/" },
];

/** Hero 解析输入框 + 解析调用 */
export function ParseBox({ compact, loading: loadingProp, onParsed, onError, onLoadingChange }: ParseBoxProps) {
  const [url, setUrl] = useState("");
  const router = useRouter();
  const loading = loadingProp;

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = url.trim();
      if (!trimmed || loading) return;
      onError("");
      onLoadingChange(true);
      try {
        const info = await parseApi(trimmed);
        onParsed(info);
      } catch (err) {
        onError(err instanceof Error ? err.message : "解析失败");
      } finally {
        onLoadingChange(false);
      }
    },
    [url, loading, onError, onParsed, onLoadingChange, router]
  );

  function fillExample(exampleUrl: string) {
    setUrl(exampleUrl);
  }

  return (
    <div className="w-full max-w-2xl">
      <form onSubmit={handleSubmit} role="search" aria-label="视频链接解析" className="relative flex items-center">
        <div className="relative flex-1">
          <label htmlFor="video-url-input" className="sr-only">
            粘贴视频链接进行解析下载
          </label>
          <LinkIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
          <input
            id="video-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            placeholder="粘贴视频链接，如 https://www.youtube.com/watch?v=..."
            disabled={loading}
            autoComplete="url"
            className="h-13 w-full rounded-full border border-border bg-white py-3.5 pl-12 pr-28 text-[15px] text-text-primary shadow-sm transition-all placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 sm:h-14 sm:rounded-l-full sm:rounded-r-none sm:pr-4"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="hidden h-14 items-center gap-2 rounded-r-full bg-primary px-8 text-[15px] font-medium text-white shadow-md transition-all hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 sm:flex cursor-pointer"
        >
          {loading ? (
            <>
              <SpinnerIcon className="h-5 w-5" />
              解析中...
            </>
          ) : (
            <>
              <DownloadIcon className="h-5 w-5" />
              解析视频
            </>
          )}
        </button>
        <button
          type="submit"
          disabled={loading || !url.trim()}
          aria-label="解析视频"
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-white disabled:opacity-50 cursor-pointer sm:hidden"
        >
          {loading ? <SpinnerIcon className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
        </button>
      </form>

      {!compact && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-text-muted">
          <span>试试：</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => fillExample(ex.url)}
              className="rounded-full border border-border bg-white px-3 py-1 transition-colors hover:border-primary hover:text-primary cursor-pointer"
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface VideoResultCardProps {
  video: VideoInfo;
  downloading: boolean;
  onDownload: (formatId: string) => void;
}

/** 视频信息卡片 + 格式选择 + 下载 */
export function VideoResultCard({ video, downloading, onDownload }: VideoResultCardProps) {
  const [selected, setSelected] = useState(video.formats?.[0]?.formatId || "");

  const thumbnail = video.thumbnail
    ? `/api/thumbnail?url=${encodeURIComponent(video.thumbnail)}`
    : "";

  const selectedFmt = video.formats?.find((f) => f.formatId === selected);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-100">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt={video.title}
              className="h-full w-full object-cover"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted">
              <span className="text-sm">无封面图</span>
            </div>
          )}
          {video.duration ? (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white">
              {formatDuration(video.duration)}
            </span>
          ) : null}
        </div>

        <div className="min-w-0">
          <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-text-primary">
            {video.title}
          </h3>
          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
            {video.uploader && video.uploader !== "未知" ? (
              <span>{video.uploader}</span>
            ) : null}
            <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary">
              {platformName(video.platform)}
            </span>
            {video.viewCount ? (
              <span>{formatCount(video.viewCount)} 次播放</span>
            ) : null}
          </div>
          {video.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-text-muted">{video.description}</p>
          ) : null}
        </div>
      </div>

      {video.formats && video.formats.length > 0 ? (
        <div className="border-t border-border-light px-5 py-5 sm:px-6">
          <h4 className="mb-3 text-sm font-medium text-text-primary">选择清晰度和格式</h4>
          <div className="grid grid-cols-1 gap-2">
            {video.formats.map((fmt) => (
              <button
                key={fmt.formatId}
                type="button"
                onClick={() => setSelected(fmt.formatId)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-colors",
                  selected === fmt.formatId
                    ? "border-primary bg-primary-light"
                    : "border-border-light hover:border-primary/40 hover:bg-zinc-50"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-medium",
                    selected === fmt.formatId ? "bg-primary text-white" : "bg-zinc-100 text-text-muted"
                  )}
                >
                  {fmt.height ? `${fmt.height}p` : "HD"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-primary">{fmt.label}</span>
                  <span className="block text-xs text-text-muted">
                    {fmt.ext.toUpperCase()} · {fmt.hasAudio ? "含音频" : "仅视频"}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={() => selected && onDownload(selected)}
              disabled={!selected || downloading}
              className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-8 text-[15px] font-medium text-white shadow-md transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <SpinnerIcon className="h-5 w-5" />
                  下载中，请稍候...
                </>
              ) : (
                <>
                  <DownloadIcon className="h-5 w-5" />
                  立即下载
                </>
              )}
            </button>
            {selectedFmt ? (
              <span className="text-center text-xs text-text-muted">已选择：{selectedFmt.label}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="border-t border-border-light px-5 py-4 text-sm text-text-muted sm:px-6">
          该视频未列出可用清晰度，可尝试直接下载或发送到邮箱。
        </p>
      )}
    </div>
  );
}