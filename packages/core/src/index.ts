/** @saveany/core — 核心逻辑库（yt-dlp / 抖音 / 字幕 / DeepSeek / SSE） */

export * from "./utils.js";
export {
  VideoDownloader,
  runYtDlp,
  hasFfmpeg,
  classifyYtDlpError,
  friendlyYtDlpError,
  YTDLP_ERROR_HINTS,
  type YtDlpErrorKind,
  type YtDlpInfo,
} from "./downloader.js";
export { DouyinParser, isDouyinUrl } from "./douyin.js";
export {
  BilibiliParser,
  isBiliVideoUrl,
  BilibiliError,
  BILIBILI_ERROR_HINTS,
  type BilibiliErrorKind,
} from "./bilibili.js";
export {
  isDomesticUrl,
  isDomesticHost,
  resolveOutboundProxy,
  resolveProxyForUrl,
  DOMESTIC_HOST_SUFFIXES,
} from "./proxy.js";
export {
  UniversalParser,
  findPlatform,
  classifyUniversalError,
  friendlyUniversalError,
  UNIVERSAL_ERROR_HINTS,
  UniversalError,
  type UniversalErrorKind,
  type PlatformStrategy,
} from "./universal/index.js";
export {
  detectPlatform,
  parseUrl,
  directUrl,
  downloadUrl,
  friendlyRouteError,
  type PlatformRoute,
  type DirectUrlResult,
} from "./router.js";
export { transcribeAudioFile, transcribeAzureFile, resolveAzureSpeechConfig, DEFAULT_DASHSCOPE_MODEL } from "./asr.js";
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