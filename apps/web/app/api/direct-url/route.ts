import { NextResponse } from "next/server";
import path from "node:path";
import { VideoDownloader, friendlyYtDlpError } from "@saveany/core";
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

/** POST /api/direct-url — 获取视频源站直链（带宽友好优先） */
export async function POST(request: Request) {
  let body: { url?: string; format_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { url, format_id } = body;
  if (!url || typeof url !== "string" || !isHttpUrl(url.trim())) {
    return NextResponse.json({ error: "请提供有效的视频链接" }, { status: 400 });
  }

  try {
    if (CONTAINER_URL) {
      const result = await callContainer<{ directUrl: string; ext: string; filesize: number | null; title: string }>(
        "/direct-url",
        { url: url.trim(), format_id: format_id || "best" }
      );
      return NextResponse.json({ data: result });
    }

    const downloader = new VideoDownloader(DOWNLOAD_DIR);
    const result = await downloader.getDirectUrl(url.trim(), format_id || "best");
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = friendlyYtDlpError(err);
    console.error("direct-url", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}