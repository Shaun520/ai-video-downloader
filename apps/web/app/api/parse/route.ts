import { NextResponse } from "next/server";
import path from "node:path";
import { VideoDownloader, DouyinParser, isDouyinUrl, friendlyYtDlpError } from "@saveany/core";
import { CONTAINER_URL, callContainer } from "@/lib/platform-client";

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
    // 部署形态：配置了容器则统一转发（容器内部已按平台分流：抖音专用 / yt-dlp）
    if (CONTAINER_URL) {
      const info = await callContainer<Record<string, unknown>>("/parse", { url: url.trim() });
      return NextResponse.json({ data: info });
    }

    if (isDouyinUrl(url)) {
      const parser = new DouyinParser(DOWNLOAD_DIR);
      const info = await parser.parse(url.trim());
      return NextResponse.json({ data: info });
    }

    const downloader = new VideoDownloader(DOWNLOAD_DIR);
    const info = await downloader.parseVideo(url.trim());
    return NextResponse.json({ data: info });
  } catch (err) {
    const message = friendlyYtDlpError(err); // 原始 ERROR 文本对用户不友好，统一转可读提示
    console.error("parse", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}