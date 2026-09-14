/** subtitle-export.ts — 字幕分段 → SRT / VTT / TXT 文件内容 */
import type { SubtitleSegment } from "./subtitle.js";

export type SubtitleFormat = "srt" | "vtt" | "txt";

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

/** 秒数 → HH:MM:SS,mmm */
function toTimestamp(totalSeconds: number, separator = ","): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${separator}${String(millis).padStart(3, "0")}`;
}

export function segmentsToSrt(segments: SubtitleSegment[]): string {
  return segments
    .map((seg, i) => {
      const start = toTimestamp(seg.start);
      const end = toTimestamp(seg.end);
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .join("\n");
}

export function segmentsToVtt(segments: SubtitleSegment[]): string {
  const header = "WEBVTT\n\n";
  const body = segments
    .map((seg) => {
      const start = toTimestamp(seg.start, ".");
      const end = toTimestamp(seg.end, ".");
      return `${start} --> ${end}\n${seg.text}\n`;
    })
    .join("\n");
  return header + body;
}

export function segmentsToTxt(segments: SubtitleSegment[]): string {
  return segments.map((seg) => seg.text).join("\n");
}

export function segmentsToFormat(segments: SubtitleSegment[], format: SubtitleFormat): string {
  if (format === "srt") return segmentsToSrt(segments);
  if (format === "vtt") return segmentsToVtt(segments);
  return segmentsToTxt(segments);
}