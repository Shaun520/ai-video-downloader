import { NextResponse } from "next/server";
import path from "node:path";
import { VideoDownloader, DouyinParser, isDouyinUrl } from "@saveany/core";

const DOWNLOAD_DIR = path.join(process.cwd(), "downloads");

/** 校验 URL 格式 */
function isHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** POST /api/parse — 解析视频信息（yt-dlp 或 抖音专用） */
export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== "string" || !isHttpUrl(url.trim())) {
    return NextResponse.json({ error: "请提供有效的视频链接" }, { status: 400 });
  }

  try {
    if (isDouyinUrl(url)) {
      const parser = new DouyinParser(DOWNLOAD_DIR);
      const info = await parser.parse(url.trim());
      return NextResponse.json({ data: info });
    }

    const downloader = new VideoDownloader(DOWNLOAD_DIR);
    const info = await downloader.parseVideo(url.trim());
    return NextResponse.json({ data: info });
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}