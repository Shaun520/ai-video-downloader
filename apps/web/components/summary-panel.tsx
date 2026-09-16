"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postSse } from "@/lib/sse-client";
import { MarkmapView } from "./markmap-view";
import { CaptionsIcon, ChatIcon, SparklesIcon, TreeIcon } from "./icons";
import { cn } from "@/lib/utils";

interface SummaryPanelProps {
  url: string;
  videoTitle: string;
  /** 触发重新总结的信号（video 变化时由父组件自增传入） */
  triggerKey: number;
  needLogin: () => void;
}

type TabKey = "summary" | "subtitle" | "mindmap" | "chat";

interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

interface SubtitleInfo {
  language?: string;
  subtitleType?: string;
  hasSubtitle?: boolean;
  segmentCount?: number;
  fullText?: string;
  segments?: SubtitleSegment[];
}

/** AI 总结面板：总结摘要 / 字幕文本 / 思维导图 / AI 问答 */
export function SummaryPanel({ url, videoTitle, triggerKey, needLogin }: SummaryPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [mindmap, setMindmap] = useState("");
  const [subtitleInfo, setSubtitleInfo] = useState<SubtitleInfo>({});
  const [subtitleLoaded, setSubtitleLoaded] = useState(false);
  const [subtitleExpanded, setSubtitleExpanded] = useState(false);
  const [showSubtitleDropdown, setShowSubtitleDropdown] = useState(false);
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const [error, setError] = useState("");

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const subtitleDropdownRef = useRef<HTMLDivElement | null>(null);

  const runSummary = useCallback(
    async (silent = false) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError("");
      setSummary((prev) => (silent ? prev : ""));
      setStatus(silent ? "" : "");
      try {
        await postSse(
          "/api/summarize",
          { url },
          {
            status: (data) => {
              try {
                const d = JSON.parse(data) as { message?: string };
                if (d.message) setStatus(d.message);
              } catch {}
            },
            text: (data) => {
              try {
                const d = JSON.parse(data) as { content?: string };
                if (d.content) setSummary((prev) => prev + d.content);
              } catch {}
            },
            subtitle: (data) => {
              try {
                const d = JSON.parse(data) as SubtitleInfo;
                setSubtitleInfo(d);
                setSubtitleLoaded(true);
              } catch {}
            },
            error: (data) => {
              try {
                const d = JSON.parse(data) as { message?: string };
                setError(d.message || "总结失败");
                setStatus("");
                setSubtitleLoaded(true);
              } catch {
                setError("总结失败");
              }
            },
            onError: (msg) => {
              if (msg.includes("请先登录")) {
                needLogin();
              } else {
                setError(msg);
              }
            },
            onDone: () => setStatus(""),
          }
        );
      } finally {
        busyRef.current = false;
      }
    },
    [url, needLogin]
  );

  const runMindmap = useCallback(async () => {
    setError("");
    setMindmap("");
    setStatus("正在生成思维导图…");
    try {
      await postSse(
        "/api/mindmap",
        { url },
        {
          status: (data) => {
            try {
              const d = JSON.parse(data) as { message?: string };
              if (d.message) setStatus(d.message);
            } catch {}
          },
          mindmap: (data) => {
            try {
              const d = JSON.parse(data) as { content?: string };
              if (d.content) setMindmap(d.content);
            } catch {}
          },
          error: (data) => {
            try {
              const d = JSON.parse(data) as { message?: string };
              setError(d.message || "生成失败");
              setStatus("");
            } catch {
              setError("生成失败");
            }
          },
          onError: (msg) => {
            if (msg.includes("请先登录")) needLogin();
            else setError(msg);
          },
          onDone: () => setStatus(""),
        }
      );
    } finally {
      setStatus("");
    }
  }, [url, needLogin]);

  const runChat = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = question.trim();
      if (!q || chatLoading) return;
      setChatLoading(true);
      setChatStatus("正在连接…");
      setError("");
      setChatHistory((h) => [...h, { role: "user", content: q }]);
      setQuestion("");
      setChatHistory((h) => [...h, { role: "assistant", content: "" }]);

      await postSse(
        "/api/chat",
        { url, question: q },
        {
          status: (data) => {
            try {
              const d = JSON.parse(data) as { message?: string };
              if (d.message) setChatStatus(d.message);
            } catch {}
          },
          text: (data) => {
            try {
              const d = JSON.parse(data) as { content?: string };
              if (d.content) {
                const chunk = d.content;
                setChatHistory((h) => {
                  const next = [...h];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant") {
                    next[next.length - 1] = {
                      role: "assistant",
                      content: (last.content ?? "") + chunk,
                    };
                  }
                  return next;
                });
              }
            } catch {}
          },
          error: (data) => {
            try {
              const d = JSON.parse(data) as { message?: string };
              setError(d.message || "回答失败");
            } catch {
              setError("回答失败");
            }
          },
          onError: (msg) => {
            if (msg.includes("请先登录")) needLogin();
            else setError(msg);
          },
        }
      );
      setChatLoading(false);
      setChatStatus("");
    },
    [question, chatLoading, url, needLogin]
  );

  const downloadSubtitle = useCallback(
    (format: "srt" | "vtt" | "txt") => {
      setShowSubtitleDropdown(false);
      const segments = subtitleInfo.segments || [];
      if (!segments.length) return;
      let content: string;
      if (format === "srt") {
        content = segments
          .map((seg, i) => `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text}\n`)
          .join("\n");
      } else if (format === "vtt") {
        content =
          "WEBVTT\n\n" +
          segments
            .map((seg) => `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${seg.text}\n`)
            .join("\n");
      } else {
        content = segments.map((seg) => seg.text).join("\n");
      }
      downloadText(content, `${filenameBase(videoTitle, url)} - 字幕.${format}`);
    },
    [subtitleInfo.segments, videoTitle, url]
  );

  // 点击外部关闭「下载字幕」下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (subtitleDropdownRef.current && !subtitleDropdownRef.current.contains(e.target as Node)) {
        setShowSubtitleDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 视频变化 → 自动重新总结
  useEffect(() => {
    if (!url) return;
    setChatHistory([]);
    setMindmap("");
    setSummaryExpanded(false);
    setSubtitleInfo({});
    setSubtitleLoaded(false);
    setSubtitleExpanded(false);
    setShowSubtitleDropdown(false);
    runSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  const subSegments = subtitleInfo.segments || [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      {/* Tab 栏 */}
      <div className="flex border-b border-border-light" role="tablist" aria-label="AI 功能">
        {(
          [
            { key: "summary", label: "总结摘要", icon: SparklesIcon },
            { key: "subtitle", label: "字幕文本", icon: CaptionsIcon },
            { key: "mindmap", label: "思维导图", icon: TreeIcon },
            { key: "chat", label: "AI 问答", icon: ChatIcon },
          ] as Array<{ key: TabKey; label: string; icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode }>
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => {
              setActiveTab(key);
              setError("");
              if (key === "mindmap" && !mindmap && !busyRef.current) runMindmap();
            }}
            className={cn(
              "relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors",
              activeTab === key ? "text-primary" : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {activeTab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-600">{error}</div>
        )}

        {/* 总结摘要 */}
        {activeTab === "summary" && (
          <div>
            {!summary ? (
              status ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                  <p className="text-sm text-text-secondary">{status}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <SparklesIcon className="mb-4 h-9 w-9 text-primary/30" />
                  <p className="text-sm text-text-muted">
                    {videoTitle ? `准备总结《${videoTitle.slice(0, 24)}${videoTitle.length > 24 ? "…" : ""}》` : "解析视频后自动生成 AI 总结"}
                  </p>
                </div>
              )
            ) : (
              <div>
                <div
                  className={cn(
                    "summary-prose overflow-y-auto",
                    summaryExpanded ? "max-h-none" : "max-h-[500px]"
                  )}
                  dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(summary) }}
                />
                {status && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-muted">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    AI 正在生成中...
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setSummaryExpanded((v) => !v)}
                  className="mt-2 cursor-pointer text-xs text-primary transition-colors hover:text-primary-dark"
                >
                  {summaryExpanded ? "收起" : "展开全部"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 字幕文本 */}
        {activeTab === "subtitle" && (
          <div>
            {subSegments.length > 0 ? (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm text-text-secondary">
                    共 {subSegments.length} 条字幕
                    {subtitleInfo.language ? (
                      <span className="ml-2 rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary">
                        {(subtitleInfo.subtitleType === "manual" ? "人工字幕" : "自动字幕")} · {subtitleInfo.language}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative" ref={subtitleDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowSubtitleDropdown((v) => !v)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary-light hover:text-primary-dark"
                      >
                        <DownloadTextIcon />
                        下载字幕
                        <svg
                          className={cn("h-3 w-3 transition-transform", showSubtitleDropdown && "rotate-180")}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="m19 9-7 7-7-7" />
                        </svg>
                      </button>
                      {showSubtitleDropdown && (
                        <div className="absolute top-full right-0 z-10 mt-1 min-w-[120px] rounded-lg border border-border-light bg-white py-1 shadow-lg">
                          {(
                            [
                              { key: "srt", label: "SRT 字幕" },
                              { key: "vtt", label: "VTT 字幕" },
                              { key: "txt", label: "纯文本" },
                            ] as const
                          ).map((f) => (
                            <button
                              key={f.key}
                              type="button"
                              onClick={() => downloadSubtitle(f.key)}
                              className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs text-text-primary transition-colors hover:bg-bg-section"
                            >
                              <span>{f.label}</span>
                              <span className="text-text-muted">.{f.key}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubtitleExpanded((v) => !v)}
                      className="cursor-pointer text-xs text-primary transition-colors hover:text-primary-dark"
                    >
                      {subtitleExpanded ? "收起" : "展开全部"}
                    </button>
                  </div>
                </div>
                <div className={cn("space-y-1 overflow-y-auto", subtitleExpanded ? "max-h-none" : "max-h-[500px]")}>
                  {subSegments.map((seg, idx) => (
                    <div key={idx} className="group flex gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-bg-section">
                      <span className="min-w-[60px] flex-shrink-0 pt-0.5 font-mono text-xs text-primary">
                        {formatTime(seg.start)}
                      </span>
                      <span className="text-sm leading-relaxed text-text-primary">{seg.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : status ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                <p className="text-sm text-text-muted">正在提取字幕...</p>
              </div>
            ) : subtitleLoaded ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-text-muted">
                <CaptionsIcon className="mb-3 h-12 w-12 opacity-40" />
                <p className="text-sm">该视频暂无可用字幕</p>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-text-muted">解析视频后将自动提取字幕并展示</p>
            )}
          </div>
        )}

        {/* 思维导图 */}
        {activeTab === "mindmap" && (
          <div>
            {status && <p className="mb-3 text-sm text-text-muted">{status}</p>}
            {mindmap ? (
              <MarkmapView markdown={mindmap} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <TreeIcon className="mb-4 h-9 w-9 text-primary/30" />
                <p className="text-sm text-text-muted">点击「思维导图」即可生成，将视频结构化为可视化导图</p>
              </div>
            )}
          </div>
        )}

        {/* AI 问答 */}
        {activeTab === "chat" && (
          <div>
            <div className="max-h-[400px] space-y-4 overflow-y-auto pr-1">
              {chatHistory.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                  <svg className="mb-3 h-12 w-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  <p className="mb-1 text-sm">向 AI 提问关于这个视频的任何问题</p>
                  <p className="text-xs">例如："这个视频的核心观点是什么？"</p>
                </div>
              )}
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "rounded-br-md bg-primary text-white"
                        : "rounded-bl-md border border-border-light bg-bg-section text-text-primary"
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <>
                        {!msg.content && chatLoading && idx === chatHistory.length - 1 ? (
                          /* 正在回复占位：三点动画 + 当前阶段文案 */
                          <p className="flex items-center gap-2 text-text-muted">
                            <span className="flex gap-1" aria-hidden>
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:0ms]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:150ms]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:300ms]" />
                            </span>
                            <span className="text-xs">{chatStatus}</span>
                          </p>
                        ) : (
                          <div
                            className="chat-prose"
                            dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(msg.content) }}
                          />
                        )}
                        {msg.content && chatLoading && idx === chatHistory.length - 1 && (
                          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary/60 align-text-bottom" />
                        )}
                      </>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={runChat} className="mt-4 flex gap-2 border-t border-border-light pt-3">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="输入你的问题..."
                disabled={chatLoading}
                className="h-11 flex-1 rounded-xl border border-border bg-white px-4 text-sm text-text-primary transition-all placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="submit"
                disabled={chatLoading || !question.trim()}
                className="flex h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-5 text-white transition-all hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="发送"
              >
                {chatLoading ? (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                ) : (
                  <SendIcon />
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

/** 下载文本文件（浏览器端） */
function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

function filenameBase(title: string, url: string): string {
  const clean = title.replace(/[\\/*?:"<>|]/g, "_").slice(0, 80) || "video";
  return clean;
}

/** 秒数 → m:ss / h:mm:ss（字幕时间戳显示） */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** 轻量安全 markdown 渲染（标题/列表/粗体/行内代码/引用/代码块/分割线 → HTML） */
function renderMarkdownSafe(md: string): string {
  const lines = md.split(/\n/);
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  const codeBuf: string[] = [];
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      closeList();
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf.length = 0;
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    const t = raw.trim();
    if (!t) {
      closeList();
      continue;
    }

    const h1 = /^# (.+)/.exec(t);
    const h2 = /^## (.+)/.exec(t);
    const h3 = /^### (.+)/.exec(t);
    if (h1) {
      closeList();
      out.push(`<h2>${inlineHtml(escapeHtml(h1[1]))}</h2>`);
      continue;
    }
    if (h2) {
      closeList();
      out.push(`<h2>${inlineHtml(escapeHtml(h2[1]))}</h2>`);
      continue;
    }
    if (h3) {
      closeList();
      out.push(`<h3>${inlineHtml(escapeHtml(h3[1]))}</h3>`);
      continue;
    }

    if (/^\s*[-*] /.test(raw)) {
      const li = inlineHtml(escapeHtml(raw.replace(/^\s*[-*] /, "")));
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${li}</li>`);
      continue;
    }
    if (/^\s*\d+\. /.test(raw)) {
      const li = inlineHtml(escapeHtml(raw.replace(/^\s*\d+\. /, "")));
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${li}</li>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(t)) {
      closeList();
      out.push("<hr />");
      continue;
    }
    if (/^>\s?/.test(raw)) {
      closeList();
      out.push(`<blockquote>${inlineHtml(escapeHtml(raw.replace(/^>\s?/, "")))}</blockquote>`);
      continue;
    }
    closeList();
    out.push(`<p>${inlineHtml(escapeHtml(t))}</p>`);
  }
  closeList();
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  return out.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 行内格式化：链接 / 行内代码 / 粗体（输入须为已转义文本） */
function inlineHtml(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function DownloadTextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M9 15h6M9 11h2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
  );
}