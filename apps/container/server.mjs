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
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  VideoDownloader,
  DouyinParser,
  SubtitleExtractor,
  isDouyinUrl,
  classifyYtDlpError,
  YTDLP_ERROR_HINTS,
  VERSION,
} from "@saveany/core";

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

/** 统一错误出口：分类 → 中文友好提示 + 结构化 code（unsupported 归 400，其余 502） */
function sendError(res, err) {
  const kind = classifyYtDlpError(err);
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`[saveany-core] ${kind}:`, raw);
  sendJson(res, kind === "unsupported" ? 400 : 502, {
    error: YTDLP_ERROR_HINTS[kind],
    code: kind,
    detail: raw,
  });
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
      return sendError(res, err);
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
      return sendError(res, err);
    }
  }

  if (route === "/subtitle") {
    try {
      const { url: target, asr_model } = await readJson(req);
      if (!target || typeof target !== "string" || !isHttpUrl(target.trim())) {
        return sendJson(res, 400, { error: "请提供有效的视频链接" });
      }
      const extractorOpts = asr_model ? { asrModel: asr_model } : undefined;
      const result = await new SubtitleExtractor(extractorOpts).extract(target.trim());
      return sendJson(res, 200, { data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }

  if (route === "/download") {
    try {
      const { url: target, format_id, audio } = await readJson(req);
      if (!target || typeof target !== "string" || !isHttpUrl(target.trim())) {
        return sendJson(res, 400, { error: "请提供有效的视频链接" });
      }
      const isAudio = audio === true || format_id === "mp3";
      let result;
      if (isDouyinUrl(target.trim())) {
        result = await new DouyinParser(DOWNLOAD_DIR).download(target.trim(), isAudio ? "audio" : "video");
      } else {
        result = await new VideoDownloader(DOWNLOAD_DIR).downloadVideo(target.trim(), format_id || "best", { audio: isAudio });
      }
      // 流式回传文件（容器有真实文件系统）
      const stat = fs.statSync(result.filepath);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Content-Length": stat.size,
        "X-Saveany-Filename": encodeURIComponent(result.filename),
        "X-Saveany-Ext": encodeURIComponent(result.ext),
      });
      const stream = fs.createReadStream(result.filepath);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    } catch (err) {
      return sendError(res, err);
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