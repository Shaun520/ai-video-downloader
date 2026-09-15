/** verify-cdn.mjs — 校验 小红书/微博/QQ 直链可访问（HEAD/GET 前 n 字节），确认 download 环节可用 */
import { directUrl } from "../packages/core/dist/index.js";

const SAMPLES = [
  { name: "小红书", url: "https://xhslink.cn/o/7bocxurjB4Q" },
  { name: "QQ短视频", url: "https://pd.qq.com/hs/cmhuyrb74?b=2" },
];
const REFERERS = {
  xiaohongshu: "https://www.xiaohongshu.com",
  qq: "https://pd.qq.com",
};

for (const s of SAMPLES) {
  try {
    const d = await directUrl(s.url, undefined, process.cwd());
    console.log(`\n== ${s.name} ==`);
    console.log("  directUrl:", d.directUrl.slice(0, 100));
    const platform = s.name === "小红书" ? "xiaohongshu" : "qq";
    const res = await fetch(d.directUrl, {
      headers: { Referer: REFERERS[platform], Range: "bytes=0-1023", "User-Agent": "Mozilla/5.0 (Linux; Android 13)" },
    });
    console.log("  status:", res.status, "| content-type:", res.headers.get("content-type"));
    const buf = await res.arrayBuffer();
    console.log("  bytes:", buf.byteLength);
  } catch (e) {
    console.log(`\n== ${s.name} == ERR:`, e.message);
  }
}