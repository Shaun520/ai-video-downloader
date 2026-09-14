/** @saveany/core — 核心逻辑库（yt-dlp / 抖音 / 字幕 / DeepSeek / SSE） */

export * from "./utils.js";
export {
  VideoDownloader,
  runYtDlp,
  hasFfmpeg,
  type YtDlpInfo,
} from "./downloader.js";
export { DouyinParser, isDouyinUrl } from "./douyin.js";
export { transcribeAudioFile, DEFAULT_DASHSCOPE_MODEL } from "./asr.js";
export {
  SubtitleExtractor,
  parseVttContent,
  type SubtitleResult,
  type SubtitleSegment,
} from "./subtitle.js";
export { segmentsToFormat, segmentsToSrt, segmentsToVtt, segmentsToTxt, type SubtitleFormat } from "./subtitle-export.js";
export { VideoSummarizer, segmentsToFullText } from "./summarize.js";
export { formatSse, sseStream } from "./sse.js";

export const VERSION = "0.2.0";