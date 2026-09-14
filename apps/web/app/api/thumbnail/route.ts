import { NextResponse } from "next/server";

/** GET /api/thumbnail — 缩略图反防盗链代理（防外链 403） */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }

  // 仅允许 http(s)
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "仅支持 http(s) 图片" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "url 无效" }, { status: 400 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://www.bilibili.com/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      cache: "no-store",
    });
    if (!upstream.ok) {
      console.error("thumbnail upstream", url, "→", upstream.status);
      return NextResponse.json({ error: "获取缩略图失败" }, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const blob = await upstream.blob();
    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("thumbnail fetch error", err);
    return NextResponse.json({ error: "获取缩略图失败" }, { status: 502 });
  }
}