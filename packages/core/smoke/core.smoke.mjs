/**
 * 核心库冒烟测试（纯本地 + 可选网络验证）
 * 运行: node smoke/core.smoke.mjs
 */
import {
  parseVttContent,
  segmentsToSrt,
  segmentsToVtt,
  segmentsToTxt,
  isDouyinUrl,
  formatDuration,
  formatFilesize,
  sanitizeFilename,
  formatSse,
  VideoDownloader,
  DouyinParser,
} from "../dist/index.js";

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log("== 1. 工具函数 ==");
assert(isDouyinUrl("https://v.douyin.com/iAbCdEf/") === true, "isDouyinUrl 识别 v.douyin.com");
assert(isDouyinUrl("https://www.youtube.com/watch?v=x") === false, "isDouyinUrl 排除 youtube");
assert(formatDuration(3725) === "1:02:05", "formatDuration 3725s → 1:02:05");
assert(formatDuration(95) === "1:35", "formatDuration 95s → 1:35");
assert(formatFilesize(1536) === "2KB", "formatFilesize 1536 → 2KB");
assert(formatFilesize(5 * 1024 * 1024) === "5.0MB", "formatFilesize 5MB");
assert(sanitizeFilename(`a/b:c*?|"<>`) === "a_b_c______", "sanitizeFilename 去非法字符");

console.log("== 2. VTT 解析 ==");
const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.200
大家好，欢迎观看

00:00:03.300 --> 00:00:06.500
<v x>今天讲 TypeScript</v>

00:00:06.600 --> 00:00:08.000
再见`;
const segs = parseVttContent(vtt);
assert(segs.length === 3, `VTT 解析出 3 条字幕 (实际 ${segs.length})`);
assert(segs[0].start === 1 && segs[0].text === "大家好，欢迎观看", "第1条 start/text 正确");
assert(segs[1].text === "今天讲 TypeScript", "第2条去除 <v> 标签");
assert(segs[2].end === 8, "第3条 end 正确");

console.log("== 3. 字幕导出 ==");
const srt = segmentsToSrt(segs);
const vttOut = segmentsToVtt(segs);
assert(srt.includes("00:00:01,000 --> 00:00:03,200"), "SRT 时间线格式（逗号毫秒）");
assert(vttOut.startsWith("WEBVTT"), "VTT 带 WEBVTT 头");
assert(segmentsToTxt(segs) === "大家好，欢迎观看\n今天讲 TypeScript\n再见", "TXT 逐行文本");

console.log("== 4. SSE 编码 ==");
const frame = formatSse("summary", '{"t":"你好"}');
assert(frame === 'event: summary\ndata: {"t":"你好"}\n\n', "SSE 帧格式正确");

console.log("== 5. 抖音直链识别（仅 URL 判断，不发请求）==");
assert(!isDouyinUrl("https://www.bilibili.com/video/BV1xx"), "非抖音链接");

console.log("== 6. 网络冒烟（可选，失败不阻断）==");
const dl = new VideoDownloader(process.env.DL_DIR || "downloads-smoke");
const douyin = new DouyinParser(process.env.DL_DIR || "downloads-smoke");

const netTests = [
  {
    name: "yt-dlp 解析 YouTube",
    run: () => dl.parseVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    check: (info) => assert(!!info.title && info.formats.length >= 0, "YT 解析返回标题"),
  },
  {
    name: "对象可实例化（不联网）",
    run: async () => true,
    check: () => assert(dl.ffmpegAvailable === (typeof dl.ffmpegAvailable === "boolean"), "ffmpeg 检测为布尔"),
  },
];

for (const t of netTests) {
  try {
    const r = await t.run();
    t.check(r);
  } catch (e) {
    console.warn(`  - ${t.name} 跳过（网络/环境原因）: ${e.message}`);
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);