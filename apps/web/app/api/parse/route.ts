import { NextResponse } from "next/server";
import path from "node:path";
import { friendlyRouteError, parseUrl } from "@saveany/core";
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

/** POST /api/parse — 解析视频信息（抖音专用 / 通用解析框架 / yt-dlp 统一路由） */
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
    // 部署形态：配置了容器则统一转发（容器内部同样走 router 分流）
    if (CONTAINER_URL) {
      const info = await callContainer<Record<string, unknown>>("/parse", { url: url.trim() });
      return NextResponse.json({ data: info });
    }

    const info = await parseUrl(url.trim(), DOWNLOAD_DIR);
    return NextResponse.json({ data: info });
  } catch (err) {
    const message = friendlyRouteError(err); // 原始 ERROR 文本对用户不友好，统一转可读提示
    console.error("parse", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}