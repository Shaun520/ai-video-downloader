import { SubtitleExtractor } from "../packages/core/dist/subtitle.js";

const url = process.argv[2] || "https://www.youtube.com/watch?v=jNQXAC9IVRw";
console.log("测试链接:", url);

const sub = await new SubtitleExtractor().extract(url);
console.log("hasSubtitle:", sub.hasSubtitle);
console.log("language:", sub.language, "| type:", sub.subtitleType);
console.log("segments:", sub.segments.length);
if (sub.segments.length) {
  console.log("前3段:", sub.segments.slice(0, 3));
} else {
  console.log("fullText:", JSON.stringify(sub.fullText).slice(0, 300));
}