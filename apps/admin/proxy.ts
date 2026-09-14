import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifySessionToken } from "./lib/auth";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 登录页与登录/登出接口无需会话
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(token);

  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};