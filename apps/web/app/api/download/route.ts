import { NextResponse } from "next/server";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { downloadUrl, friendlyRouteError } from "@saveany/core";
import { CONTAINER_URL } from "@/lib/platform-client";

export const maxDuration = 300;

const DOWNLOAD_DIR = path.join(
  process.env.TEMP || "/tmp",
  "saveany-downloads"
);

function isHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** POST /api/download — 服务端下载（流式回传文件；一次请求完成，不落库存档） */
export async function POST(request: Request) {
  let body: { url?: string; format_id?: string; audio?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { url, format_id } = body;
  if (!url || typeof url !== "string" || !isHttpUrl(url.trim())) {
    return NextResponse.json({ error: "请提供有效的视频链接" }, { status: 400 });
  }

  // 音频模式：format_id 为 "mp3" 或显式 audio=true 时，仅提取音频并转 mp3
  const isAudio = body.audio === true || format_id === "mp3";

  try {
    // 部署形态：配置了容器则转发（容器有真实文件系统；Workers 无本地磁盘）
    if (CONTAINER_URL) {
      let up: Response;
      try {
        up = await fetch(`${CONTAINER_URL}/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), format_id: format_id || "best", audio: isAudio }),
          signal: AbortSignal.timeout(600_000),
        });
      } catch {
        return NextResponse.json({ error: "核心服务（容器）不可达，请检查部署配置" }, { status: 502 });
      }
      if (!up.ok) {
        const payload = (await up.json().catch(() => ({}))) as { error?: string };
        return NextResponse.json({ error: payload.error || "下载失败" }, { status: up.status });
      }
      const filename = decodeURIComponent(up.headers.get("x-saveany-filename") || "video.mp4");
      // 容器返回体整体读入内存再转发，同样规避 Web Stream 收尾崩溃
      const buf = new Uint8Array(await up.arrayBuffer());
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Content-Length": String(buf.byteLength),
          "Cache-Control": "no-store",
        },
      });
    }

    // 统一路由：抖音专用 / 通用解析框架 / yt-dlp
    const result = await downloadUrl(url.trim(), format_id, { audio: isAudio }, DOWNLOAD_DIR);
    const filepath = result.filepath;
    const filename = result.filename;

    if (!filepath || !existsSync(/*turbopackIgnore: true*/ filepath)) {
      return NextResponse.json({ error: "下载失败：未找到输出文件" }, { status: 500 });
    }

    const stat = statSync(/*turbopackIgnore: true*/ filepath);
    if (stat.size > 512 * 1024 * 1024) {
      rmSync(/*turbopackIgnore: true*/ filepath, { force: true });
      return NextResponse.json({ error: "视频超过 512MB，暂不支持直接下载" }, { status: 413 });
    }
    // 一次性读入内存返回（未走流式，规避 Windows 上 Web Stream 响应收尾的崩溃面）；
    // 拷贝为独立 Uint8Array，避免复用 Buffer 底层 ArrayBuffer 在 undici/Next 层的问题。
    const buf = readFileSync(/*turbopackIgnore: true*/ filepath);
    const body = new Uint8Array(buf);
    rmSync(/*turbopackIgnore: true*/ filepath, { force: true });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = friendlyRouteError(err);
    console.error("download", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}