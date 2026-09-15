import { NextResponse } from "next/server";
import { createReadStream, existsSync, rmSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { VideoDownloader, DouyinParser, isDouyinUrl, friendlyYtDlpError } from "@saveany/core";
import { CONTAINER_URL } from "@/lib/platform-client";

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
      return new NextResponse(up.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "no-store",
        },
      });
    }

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

    // 手动搬运管道：视频完整传给客户端后（或客户端中途断开）立即删除服务器上的临时文件，
    // 避免 downloads 目录残留堆积。直接返回 nodeStream 无法挂"发送完成"回调，故自建转发管道。
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const reader = nodeStream.getReader();
    const writer = writable.getWriter();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        try {
          await writer.close();
        } catch {
          // 客户端已断开时 close 会抛错，忽略即可
        }
      } finally {
        // 无论完整传输还是中断，都要清理临时文件
        rmSync(/*turbopackIgnore: true*/ filepath, { force: true });
      }
    })();

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = friendlyYtDlpError(err);
    console.error("download", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}