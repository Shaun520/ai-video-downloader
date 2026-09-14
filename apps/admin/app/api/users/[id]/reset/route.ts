import { NextResponse, type NextRequest } from "next/server";
import { adminResetDailyCount } from "@saveany/db";
import { getAdminDb } from "@/lib/db";

/** POST：重置用户每日免费次数 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await adminResetDailyCount(getAdminDb(), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "重置次数失败" },
      { status: 500 }
    );
  }
}