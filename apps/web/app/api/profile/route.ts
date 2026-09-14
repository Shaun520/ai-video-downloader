import { NextResponse } from "next/server";
import { getAuthUser, getProfile, unauthorized } from "@/lib/api-auth";

/** GET /api/profile — 当前用户资料 + 今日配额 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const profile = await getProfile(user.id);
  if (!profile) {
    return NextResponse.json({ error: "用户资料不存在" }, { status: 404 });
  }

  const isVipActive = profile.is_vip && profile.vip_expire_at && new Date(profile.vip_expire_at) > new Date();

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      isVip: isVipActive,
      vipExpireAt: profile.vip_expire_at ?? undefined,
      dailySummaryCount: profile.daily_summary_count,
      lastSummaryDate: profile.last_summary_date ?? undefined,
    },
  });
}