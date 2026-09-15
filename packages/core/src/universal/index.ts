/**
 * universal/index.ts — 统一解析框架出口
 * 对外暴露：UniversalParser、平台查找、错误分类与中文提示、类型。
 */
export { UniversalParser, classifyUniversalError, friendlyUniversalError, UNIVERSAL_ERROR_HINTS, type DirectUrlResult } from "./parser.js";
export { UniversalError, type UniversalErrorKind, type PlatformStrategy, type StrategyContext } from "./types.js";
export { extractUrl, UniversalHttp, CookieJar, type UaMode } from "./http.js";
export { findPlatform, PLATFORMS } from "./platform-registry.js";