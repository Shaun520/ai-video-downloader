import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db";

/** 概览统计：用户 / VIP / 订单 / 收入 */
export async function GET() {
  try {
    const db = getAdminDb();
    const now = new Date().toISOString();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [userCount, vipCount, todayNew, ordersCount, revenue, recentOrders] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true }),
      db.from("users").select("id", { count: "exact", head: true }).eq("is_vip", true).gt("vip_expire_at", now),
      db.from("users").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
      db.from("orders").select("id", { count: "exact", head: true }),
      db.from("orders").select("amount").eq("status", "paid"),
      db.from("orders").select("*").order("created_at", { ascending: false }).limit(8),
    ]);

    const revenueTotal =
      (revenue.data as Array<{ amount: number }> | null)?.reduce((sum, o) => sum + o.amount, 0) ?? 0;

    return NextResponse.json({
      totalUsers: userCount.count ?? 0,
      vipUsers: vipCount.count ?? 0,
      todayNew: todayNew.count ?? 0,
      totalOrders: ordersCount.count ?? 0,
      revenue: revenueTotal, // 单位：分
      recentOrders: (recentOrders.data ?? []).slice(0, 8),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "获取统计失败" },
      { status: 500 }
    );
  }
}