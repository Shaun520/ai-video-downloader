"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoInfo } from "@saveany/shared";
import { ParseBox, VideoResultCard, directUrlApi } from "./parse-box";
import { SummaryPanel } from "./summary-panel";

/** 以 blob 方式强制保存文件（跨域直链的 download 属性会被浏览器忽略，blob URL 则始终生效）；
 *  返回 false 表示直链不可用（CORS 受限/网络失败），由调用方回退到服务端下载。 */
async function forceSaveFile(href: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(href, { mode: "cors" });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;
    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "video.mp4";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    return false;
  }
}

/** 首页主工作区：Hero 解析 → 视频信息 + AI 总结（同屏双栏） */
export function HomeWorkspace() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [aiOpened, setAiOpened] = useState(false);
  const [summaryKey, setSummaryKey] = useState(0);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const handleParsed = useCallback((info: VideoInfo) => {
    setVideo(info);
    setUrl(info.url);
    setAiOpened(false);
    setSummaryKey(0);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const handleOpenAi = useCallback(() => {
    setAiOpened(true);
    setSummaryKey((k) => k + 1);
  }, []);

  const handleDownload = useCallback(
    async (formatId: string) => {
      if (!url) return;
      setDownloading(true);
      setError("");
      const selectedFmt = video?.formats?.find((f) => f.formatId === formatId);
      const isAudio = formatId === "mp3";
      try {
        // 1. 优先尝试直链（仅适用于"完整单文件"格式，如抖音无水印/单格式 MP4；音频无直链方案，跳过）
        let directUrl = selectedFmt?.url || "";
        if (!isAudio && !directUrl && !formatId.includes("+")) {
          try {
            const direct = await directUrlApi(url, formatId);
            directUrl = direct.directUrl;
          } catch {
            // 直链不可用 → 走服务端下载
          }
        }
        if (!isAudio && directUrl && !formatId.includes("+")) {
          const saved = await forceSaveFile(directUrl, `video.${selectedFmt?.ext || "mp4"}`);
          if (saved) return;
        }
        // 2. 服务端中转下载：合并音视频（+ 格式）、音频提取（mp3）或直链跨域受限时兜底
        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, format_id: formatId, ...(isAudio ? { audio: true } : {}) }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "下载失败");
        }
        const blob = await res.blob();
        const disposition = res.headers.get("content-disposition") || "";
        const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        const filename = match
          ? decodeURIComponent(match[1])
          : isAudio
            ? "audio.mp3"
            : `video.${selectedFmt?.ext || "mp4"}`;
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(objectUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "下载失败，请稍后重试");
        if (err instanceof Error && err.message.includes("请先登录")) {
          router.push("/login?next=/");
        }
      } finally {
        setDownloading(false);
      }
    },
    [url, video, router]
  );

  const handleParseError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  return (
    <>
      {/* 解析 Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary-light to-bg-main">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -right-40 -top-40 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-blue-400/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl px-4 pb-14 pt-16 text-center sm:px-6 sm:pt-24">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-1.5 text-sm text-text-secondary shadow-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            支持 1800+ 平台 · 免费使用
          </div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-text-primary sm:text-5xl">
            免费在线视频下载器
            <span className="text-primary">，一键保存</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-text-secondary sm:text-lg">
            粘贴视频链接，智能解析下载。支持 YouTube、B 站、抖音等主流平台，
            多种清晰度可选，还能用 AI 总结视频内容。
          </p>
          <div className="mt-10">
            <ParseBox
              compact={!!video}
              loading={loading}
              onParsed={handleParsed}
              onError={handleParseError}
              onLoadingChange={setLoading}
            />
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </div>
        </div>
      </section>

      {/* 结果区 */}
      {video ? (
        <section ref={resultRef} className="bg-bg-main py-8 sm:py-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className={aiOpened ? "flex flex-col gap-6 lg:flex-row" : "mx-auto max-w-3xl"}>
              <div className={aiOpened ? "w-full lg:w-2/5 lg:flex-shrink-0" : "w-full"}>
                <VideoResultCard
                  video={video}
                  downloading={downloading}
                  onDownload={handleDownload}
                  onSummarize={handleOpenAi}
                  aiOpened={aiOpened}
                />
              </div>
              {aiOpened ? (
                <div className="min-w-0 flex-1">
                  <SummaryPanel
                    url={url}
                    videoTitle={video.title}
                    triggerKey={summaryKey}
                    needLogin={() => router.push("/login?next=/")}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}