/**
 * downloader.ts — yt-dlp 通用封装（解析 / 下载 / 直链）
 * 通过 spawn 子进程调用系统 yt-dlp，不依赖 Python。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import { formatFilesize, sanitizeFilename } from "./utils.js";

/** yt-dlp 原始 info 中的 format */
interface RawFormat {
  format_id?: string;
  ext?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  url?: string;
  resolution?: string;
  format_note?: string;
}

/** yt-dlp raw info object（结构化字段子集） */
export interface YtDlpInfo {
  id?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  duration_string?: string;
  uploader?: string;
  channel?: string;
  extractor?: string;
  extractor_key?: string;
  view_count?: number;
  upload_date?: string;
  description?: string;
  url?: string;
  ext?: string;
  requested_formats?: Array<{ url?: string; ext?: string }>;
  formats?: RawFormat[];
  subtitles?: Record<string, unknown[]>;
  automatic_captions?: Record<string, unknown[]>;
}

/** 执行 yt-dlp 并返回完整 stdout */
export function runYtDlp(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp 执行超时"));
    }, opts.timeoutMs ?? 120_000);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 yt-dlp：${err.message}。请确认已安装 yt-dlp。`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `yt-dlp 退出码 ${code}`));
    });
  });
}

/** 检测 ffmpeg 是否可用（音视频合并需要） */
export function hasFfmpeg(): boolean {
  const res = spawnSync("ffmpeg", ["-version"], { windowsHide: true, timeout: 5000, encoding: "utf8" });
  return !res.error && res.status === 0;
}

export class VideoDownloader {
  readonly downloadDir: string;
  readonly ffmpegAvailable: boolean;

  constructor(downloadDir: string) {
    this.downloadDir = downloadDir;
    this.ffmpegAvailable = hasFfmpeg();
  }

  private baseArgs(download: boolean): string[] {
    return [
      "--quiet",
      "--no-warnings",
      "--no-playlist",
      ...(download ? [] : ["--skip-download"]),
    ];
  }

  /** 解析视频信息 */
  async parseVideo(url: string): Promise<VideoInfo> {
    const args = [
      ...this.baseArgs(false),
      "--dump-single-json",
      url,
    ];
    const stdout = await runYtDlp(args);
    let info: YtDlpInfo;
    try {
      info = JSON.parse(stdout) as YtDlpInfo;
    } catch {
      throw new Error("yt-dlp 输出无法解析");
    }

    const formats = this.extractFormats(info);
    const platform = info.extractor || info.extractor_key || "Unknown";

    const subtitles = Object.entries(info.subtitles || {}).map(([lang, list]) => ({
      language: lang,
      auto: false,
      ...(Array.isArray(list) && list.length > 0 ? { url: (list[0] as { url?: string }).url } : {}),
    }));
    const autoSubs = Object.entries(info.automatic_captions || {}).slice(0, 5).map(([lang, list]) => ({
      language: lang,
      auto: true,
      ...(Array.isArray(list) && list.length > 0 ? { url: (list[0] as { url?: string }).url } : {}),
    }));

    return {
      id: info.id || "",
      title: info.title || "未知标题",
      thumbnail: info.thumbnail || "",
      description: (info.description || "").slice(0, 200),
      duration: info.duration,
      uploader: info.uploader || info.channel || "未知",
      platform,
      viewCount: info.view_count,
      uploadDate: info.upload_date || "",
      url,
      formats,
      subtitles: [...subtitles, ...autoSubs],
    };
  }

  /** 从 raw formats 提取整理为前端可用列表 */
  extractFormats(info: YtDlpInfo): VideoFormat[] {
    const raw = (info.formats || []) as RawFormat[];
    if (!raw.length) return [];

    const seen = new Set<string>();
    const results: VideoFormat[] = [];

    for (const f of raw) {
      const vcodec = f.vcodec || "none";
      const acodec = f.acodec || "none";
      const height = f.height;
      const ext = f.ext || "mp4";

      const hasVideo = vcodec !== "none" && !!vcodec;
      if (!hasVideo) continue;

      const filesize = f.filesize || f.filesize_approx;
      const sizeLabel = formatFilesize(filesize);

      const key = `${height}|${ext}|${acodec !== "none" ? "av" : "v"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        formatId: f.format_id || "",
        ext,
        resolution: height ? `${f.width || "?"}x${height}` : "未知",
        height: height || 0,
        filesize: filesize || null,
        filesizeApprox: filesize || null,
        vcodec,
        acodec: acodec !== "none" ? acodec : null,
        hasAudio: acodec !== "none",
        label: height
          ? `${height}p ${ext.toUpperCase()} (${sizeLabel})${acodec === "none" ? " 仅视频" : ""}`
          : `${ext.toUpperCase()} (${sizeLabel})`,
      });
    }

    results.sort((a, b) => (b.height || 0) - (a.height || 0));

    if (results.length && !results.some((r) => r.hasAudio)) {
      results.unshift({
        formatId: "bestvideo+bestaudio/best",
        ext: "mp4",
        resolution: results[0].resolution,
        height: results[0].height || 0,
        filesize: null,
        vcodec: "best",
        acodec: "merged",
        hasAudio: true,
        label: `${results[0].height || ""}p 最佳 (视频+音频合并)`,
      });
    }

    return results.slice(0, 15);
  }

  /** 服务端下载视频，返回落盘路径 */
  async downloadVideo(url: string, formatId: string): Promise<{ filepath: string; filename: string; title: string; ext: string }> {
    let fmt = formatId;
    if (!this.ffmpegAvailable && fmt.includes("+")) fmt = "best";

    const args = [
      ...this.baseArgs(true),
      "--format", fmt,
      "--output", path.join(this.downloadDir, "%(title)s.%(ext)s"),
      "--paths", this.downloadDir,
      "--print", "after_move:filepath",
      ...(this.ffmpegAvailable ? ["--merge-output-format", "mp4"] : []),
      url,
    ];
    const stdout = await runYtDlp(args, { timeoutMs: 600_000 });

    let filepath = stdout.trim().split("\n").pop()?.trim() || "";
    if (!filepath || !existsSync(/*turbopackIgnore: true*/ filepath)) {
      // 兜底：在下载目录中按标题前缀查找最新文件
      const title = await this.getTitle(url);
      const match = readdirSync(/*turbopackIgnore: true*/ this.downloadDir).find((f) => f.includes(sanitizeFilename(title).slice(0, 30)) || f.includes(title.slice(0, 20)));
      if (match) filepath = path.join(this.downloadDir, match);
    }
    if (!filepath || !existsSync(/*turbopackIgnore: true*/ filepath)) throw new Error("下载失败：未找到输出文件");

    const filename = path.basename(filepath);
    return {
      filepath,
      filename,
      title: filename.replace(/\.[^.]+$/, ""),
      ext: filename.split(".").pop() || "mp4",
    };
  }

  /** 获取视频直链（带宽友好，优先方案） */
  async getDirectUrl(url: string, formatId: string): Promise<{ directUrl: string; ext: string; filesize: number | null; title: string }> {
    const args = [
      ...this.baseArgs(false),
      "--format", formatId,
      "--dump-single-json",
      url,
    ];
    const stdout = await runYtDlp(args);
    let info: YtDlpInfo;
    try {
      info = JSON.parse(stdout) as YtDlpInfo;
    } catch {
      throw new Error("无法解析直链信息");
    }

    let directUrl = info.url || "";
    if (!directUrl && info.requested_formats?.length) {
      directUrl = info.requested_formats[0].url || "";
    }
    if (!directUrl) throw new Error("该视频不支持直链下载，请使用服务端下载模式");

    return {
      directUrl,
      ext: info.ext || "mp4",
      filesize: null,
      title: info.title || "video",
    };
  }

  private async getTitle(url: string): Promise<string> {
    try {
      const parsed = await this.parseVideo(url);
      return parsed.title;
    } catch {
      return "video";
    }
  }
}