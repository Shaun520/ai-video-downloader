import { NextResponse, type NextRequest } from "next/server";
import { adminListUsers, toUserProfile } from "@saveany/db";
import { getAdminDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(0, Number(sp.get("page") ?? "0"));
    const pageSize = Math.min(50, Math.max(1, Number(sp.get("per_page") ?? "20")));
    const keyword = sp.get("keyword")?.trim() || undefined;

    const { users, total } = await adminListUsers(getAdminDb(), { page, pageSize, keyword });
    return NextResponse.json({
      data: users.map(toUserProfile),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询用户失败" },
      { status: 500 }
    );
  }
}