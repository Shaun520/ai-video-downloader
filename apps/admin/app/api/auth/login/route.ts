import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, checkAdminPassword, cookieOptions, signSessionToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, await signSessionToken(), cookieOptions());
  return res;
}