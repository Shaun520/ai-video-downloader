/** verify-universal.mjs — 验证 UniversalParser 对 5 个示例链接的解析/直链/下载（联网） */
import { UniversalParser, directUrl, downloadUrl, findPlatform } from "../packages/core/dist/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const DOWNLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".verify");
mkdirSync(DOWNLOAD_DIR, { recursive: true });

const SAMPLES = [
  { name: "小红书", url: "https://xhslink.cn/o/7bocxurjB4Q" },
  { name: "微博", url: "https://video.weibo.com/show?fid=1034:5327209448276008" },
  { name: "快手", url: "https://v.kuaishou.com/n9s0TDfH" },
  { name: "微信视频号", url: "https://weixin.qq.com/sph/Ah4wlTxsjZ" },
  { name: "QQ短视频", url: "https://pd.qq.com/hs/cmhuyrb74?b=2" },
];

for (const s of SAMPLES) {
  console.log(`\n========== ${s.name} ==========`);
  try {
    const strategy = findPlatform(s.url);
    console.log("detect platform:", strategy ? strategy.id : "NONE");
    const parser = new UniversalParser(DOWNLOAD_DIR);
    const info = await parser.parse(s.url);
    console.log("  platform:", info.platform, "| id:", info.id);
    console.log("  title:", (info.title || "").slice(0, 60));
    console.log("  uploader:", info.uploader, "| duration:", info.duration, "s");
    console.log("  thumbnail:", (info.thumbnail || "").slice(0, 90));
    console.log("  formats:", JSON.stringify(info.formats).slice(0, 260));
    const d = await directUrl(s.url, undefined, DOWNLOAD_DIR);
    console.log("  directUrl:", d.directUrl.slice(0, 120));
  } catch (e) {
    console.log("  ERR:", e.constructor.name, "|", e.message);
  }
}

// 下载验证：只抽 快手（体积小）做落盘检查；微信视频号预期抛 needs_login
console.log("\n========== DOWNLOAD 快手 ==========");
try {
  const r = await downloadUrl("https://v.kuaishou.com/n9s0TDfH", undefined, undefined, DOWNLOAD_DIR);
  console.log("  ok:", r.filename, r.ext);
} catch (e) {
  console.log("  ERR:", e.constructor.name, "|", e.message);
}
console.log("DONE");