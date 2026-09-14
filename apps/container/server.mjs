/**
 * 核心容器服务（Cloudflare Containers / Docker 运行）
 * 暴露 /health /parse /direct-url /subtitle 标准 JSON 接口，
 * 复用 @saveany/core（yt-dlp 封装 + 抖音解析 + 字幕提取）。
 *
 * 无框架依赖，纯 node:http，便于容器化与边缘部署。
 */
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { VideoDownloader, DouyinParser, SubtitleExtractor, isDouyinUrl, VERSION } from "@saveany/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), "saveany-dl");

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("请求格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function isHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const route = url.pathname;

  if (req.method === "GET" && route === "/health") {
    return sendJson(res, 200, { ok: true, version: VERSION, service: "saveany-core" });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  if (route === "/parse") {
    try {
      const { url: target } = await readJson(req);
      if (!target || typeof target !== "string" || !isHttpUrl(target.trim())) {
        return sendJson(res, 400, { error: "请提供有效的视频链接" });
      }
      const info = isDouyinUrl(target.trim())
        ? await new DouyinParser(DOWNLOAD_DIR).parse(target.trim())
        : await new VideoDownloader(DOWNLOAD_DIR).parseVideo(target.trim());
      return sendJson(res, 200, { data: info });
    } catch (err) {
      return sendJson(res, 500, { error: err instanceof Error ? err.message : "解析失败" });
    }
  }

  if (route === "/direct-url") {
    try {
      const { url: target, format_id } = await readJson(req);
      if (!target || typeof target !== "string" || !isHttpUrl(target.trim())) {
        return sendJson(res, 400, { error: "请提供有效的视频链接" });
      }
      const result = await new VideoDownloader(DOWNLOAD_DIR).getDirectUrl(target.trim(), format_id || "best");
      return sendJson(res, 200, { data: result });
    } catch (err) {
      return sendJson(res, 500, { error: err instanceof Error ? err.message : "获取直链失败" });
    }
  }

  if (route === "/subtitle") {
    try {
      const { url: target } = await readJson(req);
      if (!target || typeof target !== "string" || !isHttpUrl(target.trim())) {
        return sendJson(res, 400, { error: "请提供有效的视频链接" });
      }
      const result = await new SubtitleExtractor().extract(target.trim());
      return sendJson(res, 200, { data: result });
    } catch (err) {
      return sendJson(res, 500, { error: err instanceof Error ? err.message : "字幕提取失败" });
    }
  }

  return sendJson(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  console.log(`[saveany-core] listening on :${PORT} (${VERSION})`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});