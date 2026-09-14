import { NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { VideoDownloader, DouyinParser, isDouyinUrl } from "@saveany/core";

export const maxDuration = 300;

const DOWNLOAD_DIR = path.join(process.cwd(), "downloads");

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

  // 幂等去重：以 removePrefix 形式兼容 yt-dlp 重名覆盖
  const downloader = new VideoDownloader(DOWNLOAD_DIR);

  try {
    let filepath = "";
    let filename = "";
    if (isDouyinUrl(url)) {
      const parser = new DouyinParser(DOWNLOAD_DIR);
      const result = await parser.download(url.trim(), isAudio ? "audio" : "video");
      filepath = result.filepath;
      filename = result.filename;
    } else {
      const result = await downloader.downloadVideo(url.trim(), format_id || "best", { audio: isAudio });
      filepath = result.filepath;
      filename = result.filename;
    }

    if (!filepath || !existsSync(/*turbopackIgnore: true*/ filepath)) {
      return NextResponse.json({ error: "下载失败：未找到输出文件" }, { status: 500 });
    }

    const stat = statSync(/*turbopackIgnore: true*/ filepath);
    const stream = createReadStream(/*turbopackIgnore: true*/ filepath);
    const nodeStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return new NextResponse(nodeStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "下载失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}