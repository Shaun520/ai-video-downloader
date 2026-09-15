/**
 * universal/platform-registry.ts — 平台策略注册表（声明式，可热插拔）
 * 新增平台 = 新增策略文件 + 在此注册一行。
 */
import type { PlatformStrategy } from "./types.js";
import { extractUrl } from "./http.js";
import { xiaohongshuStrategy } from "./strategies/xiaohongshu.js";
import { weiboStrategy } from "./strategies/weibo.js";
import { kuaishouStrategy } from "./strategies/kuaishou.js";
import { weixinStrategy } from "./strategies/weixin.js";
import { qqStrategy } from "./strategies/qq.js";

/** 注册的平台策略（顺序不重要，match 按 host 判定） */
export const PLATFORMS: PlatformStrategy[] = [
  xiaohongshuStrategy,
  weiboStrategy,
  kuaishouStrategy,
  weixinStrategy,
  qqStrategy,
];

/** 按用户输入（可能是分享文案）定位平台策略 */
export function findPlatform(input: string): PlatformStrategy | undefined {
  let candidate = input;
  try {
    candidate = extractUrl(input);
  } catch {
    if (input.includes(" ")) return undefined;
    candidate = input;
  }
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    return PLATFORMS.find((s) => s.match(host));
  } catch {
    return undefined;
  }
}