import { NextResponse, type NextRequest } from "next/server";
import { adminSetVip } from "@saveany/db";
import { getAdminDb } from "@/lib/db";

/** PATCH：设置/取消 VIP。body: { expireAt: ISO 字符串 | null } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    let expireAt: string | null = null;
    try {
      const body = (await req.json()) as { expireAt?: string | null };
      expireAt = body.expireAt ?? null;
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    if (expireAt !== null && Number.isNaN(new Date(expireAt).getTime())) {
      return NextResponse.json({ error: "无效的过期时间" }, { status: 400 });
    }

    await adminSetVip(getAdminDb(), id, expireAt);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "更新 VIP 失败" },
      { status: 500 }
    );
  }
}