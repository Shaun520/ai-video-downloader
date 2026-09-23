import { NextResponse } from "next/server";
import { resolveProxyForUrl } from "@saveany/core";

/** 按目标域生成防盗链 Referer */
function refererFor(url: string): string {
  try {
    return new URL(url).origin + "/";
  } catch {
    return "https://www.google.com/";
  }
}

/** GET /api/thumbnail — 缩略图反防盗链代理（防外链 403 / 海外 CDN 直连不可达） */
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
    // 本机/容器 Node 环境：海外 CDN 图经代理拉取（国内 CDN 直连，与 yt-dlp 判定一致，见 core/proxy.ts）。
    // Cloudflare Worker 环境：默认无代理配置，走 Cloudflare 全球网络，无需代理。
    const proxy = resolveProxyForUrl(url);
    const base: RequestInit = {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: refererFor(url),
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      cache: "no-store",
    };

    let upstream: Response;
    if (proxy) {
      // 注意：ProxyAgent 必须配 undici 自带的 fetch，全局 fetch 与其不兼容；
      // undici 的 Response 类型与 Web Response 有细微差异，这里做一次断言。
      const { ProxyAgent, fetch: proxyFetch } = await import("undici");
      upstream = (await proxyFetch(url, {
        method: "GET",
        headers: base.headers,
        cache: "no-store",
        dispatcher: new ProxyAgent(proxy),
      })) as unknown as Response;
    } else {
      upstream = await fetch(url, base);
    }

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