import { NextResponse, type NextRequest } from "next/server";
import { adminListOrders, toOrder } from "@saveany/db";
import { getAdminDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(0, Number(sp.get("page") ?? "0"));
    const pageSize = Math.min(50, Math.max(1, Number(sp.get("per_page") ?? "20")));
    const status = sp.get("status")?.trim() || undefined;
    const userId = sp.get("user_id")?.trim() || undefined;

    const validStatus = status
      ? (["pending", "paid", "canceled", "refunded"] as const).includes(status as never)
      : false;
    const { orders, total } = await adminListOrders(getAdminDb(), {
      page,
      pageSize,
      userId,
      status: validStatus ? status : undefined,
    });
    return NextResponse.json({
      data: orders.map(toOrder),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询订单失败" },
      { status: 500 }
    );
  }
}