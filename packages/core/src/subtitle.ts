/**
 * subtitle.ts — 视频字幕提取（人工字幕 > 自动字幕）
 * B 站走 dm/view API；其余平台通过 yt-dlp 下载字幕到临时目录后解析 VTT。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runYtDlp } from "./downloader.js";
import { requestWithRetry, DESKTOP_UA } from "./utils.js";
import { DouyinParser, isDouyinUrl } from "./douyin.js";
import { transcribeAudioFile } from "./asr.js";

export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleResult {
  hasSubtitle: boolean;
  language: string;
  subtitleType: "manual" | "auto" | "none";
  segments: SubtitleSegment[];
  fullText: string;
}

const PREFERRED_LANGS = ["zh-Hans", "zh", "zh-CN", "en", "ja", "ko"];
const SUBTITLE_FORMAT_PREFERENCE = ["json3", "srv3", "vtt", "ttml"];

function isBilibiliUrl(url: string): boolean {
  return url.includes("bilibili.com") || url.includes("b23.tv");
}

/** 从 VTT 文本解析分段 */
export function parseVttContent(content: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  const blocks = content.split(/\n\n+/);
  const timePattern = /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/;
  const seenTexts = new Set<string>();

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let timeMatch: RegExpExecArray | null = null;
    const textLines: string[] = [];
    for (const line of lines) {
      const m = timePattern.exec(line);
      if (m) timeMatch = m;
      else if (timeMatch && line.trim() && !/^\d+$/.test(line.trim())) {
        const clean = line.trim().replace(/<[^>]+>/g, "");
        if (clean) textLines.push(clean);
      }
    }
    if (timeMatch && textLines.length) {
      const text = textLines.join(" ");
      if (seenTexts.has(text)) continue;
      seenTexts.add(text);
      segments.push({
        start: round2(timeToSeconds(timeMatch[1])),
        end: round2(timeToSeconds(timeMatch[2])),
        text,
      });
    }
  }
  return segments;
}

function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(":");
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class SubtitleExtractor {
  /** 提取视频字幕 */
  async extract(url: string): Promise<SubtitleResult> {
    if (isBilibiliUrl(url)) {
      const result = await this.extractBilibili(url);
      if (result.hasSubtitle) return result;
    }

    // 抖音：无字幕轨道，走分享页数据源；不调 yt-dlp（其抖音提取器需 Cookie 会报错）
    if (isDouyinUrl(url)) {
      return this.extractDouyin(url);
    }

    const info = await this.getVideoInfo(url);

    const manualSubs = { ...(info.subtitles || {}) } as Record<string, Array<{ ext?: string; url?: string }>>;
    delete manualSubs["danmaku"];
    const autoSubs = (info.automatic_captions || {}) as Record<string, Array<{ ext?: string; url?: string }>>;

    const picked = this.pickBestSubtitle(manualSubs, autoSubs);
    if (!picked.url) {
      return { hasSubtitle: false, language: "", subtitleType: "none", segments: [], fullText: "" };
    }

    const segments = await this.downloadAndParse(url, picked.language, picked.type);
    return {
      hasSubtitle: true,
      language: picked.language,
      subtitleType: picked.type,
      segments,
      fullText: segments.map((s) => s.text).join(" "),
    };
  }

  /**
   * 抖音专用字幕提取：走分享页数据源，不调 yt-dlp。
   * 抖音无公开字幕轨道，若配置了 DASHSCOPE_API_KEY 则用 paraformer-v2 转写视频语音，
   * 以转写结果作为"自动字幕"；未配置或转写无语音（纯 BGM）时优雅降级为"无字幕"，
   * 避免 yt-dlp 抖音提取器因缺少 Cookie 抛出 "Fresh cookies needed" 导致 AI 总结报错。
   */
  private async extractDouyin(url: string): Promise<SubtitleResult> {
    const empty: SubtitleResult = { hasSubtitle: false, language: "", subtitleType: "none", segments: [], fullText: "" };
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) return empty; // 未配置 ASR：保持原有"无字幕"降级

    try {
      const parser = new DouyinParser(/*turbopackIgnore: true*/ path.join(tmpdir(), "saveany-douyin"));
      const fileUrl = await parser.getTranscribeUrl(url);
      if (!fileUrl) return empty;
      const segments = await transcribeAudioFile(fileUrl, apiKey);
      if (!segments.length) return empty; // 纯 BGM 无人声
      return {
        hasSubtitle: true,
        language: "zh",
        subtitleType: "auto",
        segments,
        fullText: segments.map((s) => s.text).join(" "),
      };
    } catch {
      return empty; // 转写失败同样按无字幕降级，不让原始错误冒泡
    }
  }

  /** B 站专用字幕提取 */
  private async extractBilibili(url: string): Promise<SubtitleResult> {
    const empty: SubtitleResult = { hasSubtitle: false, language: "", subtitleType: "none", segments: [], fullText: "" };
    try {
      const headers = {
        "User-Agent": DESKTOP_UA,
        Referer: `https://www.bilibili.com/`,
      };

      // b23.tv 短链不含 BV 号：跟随重定向解析出真实视频链接
      let bvid = /(BV[a-zA-Z0-9]+)/.exec(url)?.[1];
      if (!bvid) {
        const resp = await requestWithRetry(url, { headers, timeoutMs: 15000, redirect: "follow" });
        bvid = /(BV[a-zA-Z0-9]+)/.exec(resp.url)?.[1];
        if (!bvid) return empty;
        headers.Referer = `https://www.bilibili.com/video/${bvid}`;
      }

      const viewResp = await requestWithRetry(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        { headers, timeoutMs: 15000 }
      );
      const viewJson = (await viewResp.json()) as { data?: { cid?: number; aid?: number } };
      const viewData = viewJson?.data ?? {};
      const cid = viewData.cid;
      const aid = viewData.aid;
      if (!cid || !aid) return empty;

      const dmResp = await requestWithRetry(
        `https://api.bilibili.com/x/v2/dm/view?aid=${aid}&oid=${cid}&type=1`,
        { headers, timeoutMs: 15000 }
      );
      const body = (await dmResp.json()) as { data?: { subtitle?: { subtitles?: Array<{ lan?: string; subtitle_url?: string }> } } };
      const subtitleList = body?.data?.subtitle?.subtitles || [];
      if (!subtitleList.length) return empty;

      let best = subtitleList[0] as { lan?: string; subtitle_url?: string };
      for (const s of subtitleList as Array<{ lan?: string; subtitle_url?: string }>) {
        if (s.lan === "zh" || s.lan === "zh-Hans") {
          best = s;
          break;
        }
      }

      const subType = best.lan?.startsWith("ai-") ? ("auto" as const) : ("manual" as const);

      let subUrl = best.subtitle_url || "";
      if (subUrl.startsWith("//")) subUrl = "https:" + subUrl;
      if (subUrl.startsWith("http://")) subUrl = "https://" + subUrl.slice(7);
      if (!subUrl) return empty;

      const subResp = await requestWithRetry(subUrl, { headers, timeoutMs: 15000 });
      const subJson = (await subResp.json()) as { body?: Array<{ from?: number; to?: number; content?: string }> };

      const segments: SubtitleSegment[] = [];
      for (const item of subJson.body || []) {
        const content = (item.content || "").trim();
        if (!content) continue;
        segments.push({ start: round2(item.from || 0), end: round2(item.to || 0), text: content });
      }

      return {
        hasSubtitle: true,
        language: best.lan || "zh",
        subtitleType: subType,
        segments,
        fullText: segments.map((s) => s.text).join(" "),
      };
    } catch {
      return empty;
    }
  }

  private async getVideoInfo(url: string): Promise<Record<string, unknown>> {
    const args = [
      "--quiet", "--no-warnings", "--no-playlist",
      "--skip-download", "--dump-single-json",
      url,
    ];
    const stdout = await runYtDlp(args);
    try {
      return JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error("无法解析视频链接");
    }
  }

  private pickBestSubtitle(
    manualSubs: Record<string, Array<{ ext?: string; url?: string }>>,
    autoSubs: Record<string, Array<{ ext?: string; url?: string }>>
  ): { language: string; url: string; type: "manual" | "auto" } {
    for (const lang of PREFERRED_LANGS) {
      if (manualSubs[lang]) {
        const url = getFormatUrl(manualSubs[lang]);
        if (url) return { language: lang, url, type: "manual" };
      }
    }
    for (const lang of PREFERRED_LANGS) {
      if (autoSubs[lang]) {
        const url = getFormatUrl(autoSubs[lang]);
        if (url) return { language: lang, url, type: "auto" };
      }
    }
    for (const [lang, list] of Object.entries(manualSubs)) {
      const url = getFormatUrl(list);
      if (url) return { language: lang, url, type: "manual" };
    }
    for (const [lang, list] of Object.entries(autoSubs)) {
      const url = getFormatUrl(list);
      if (url) return { language: lang, url, type: "auto" };
    }
    return { language: "", url: "", type: "auto" };
  }

  /** 通过 yt-dlp 下载字幕文件到临时目录并解析 */
  private async downloadAndParse(url: string, lang: string, subType: "manual" | "auto"): Promise<SubtitleSegment[]> {
    const tmpDir = mkdtempSync(/*turbopackIgnore: true*/ path.join(tmpdir(), "subtitle-"));
    try {
      const args = [
        "--quiet", "--no-warnings", "--no-playlist",
        "--skip-download",
        ...(subType === "manual" ? ["--write-subs"] : ["--write-auto-subs"]),
        "--sub-langs", lang,
        "--sub-format", "vtt",
        "--output", path.join(/*turbopackIgnore: true*/ tmpDir, "subtitle"),
        "--paths", tmpDir,
        url,
      ];
      await runYtDlp(args, { timeoutMs: 180_000 });

      const vttFiles = readdirSync(/*turbopackIgnore: true*/ tmpDir).filter((f) => f.endsWith(".vtt"));
      if (!vttFiles.length) return [];
      const vttContent = readFileSync(/*turbopackIgnore: true*/ path.join(tmpDir, vttFiles[0]), "utf-8");
      return parseVttContent(vttContent);
    } finally {
      rmSync(/*turbopackIgnore: true*/ tmpDir, { recursive: true, force: true });
    }
  }
}

function getFormatUrl(formats: Array<{ ext?: string; url?: string }>): string {
  for (const pref of SUBTITLE_FORMAT_PREFERENCE) {
    for (const fmt of formats) {
      if (fmt.ext === pref && fmt.url) return fmt.url;
    }
  }
  return formats[0]?.url || "";
}