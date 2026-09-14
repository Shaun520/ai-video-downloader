import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@saveany/db";
import { createAdminClient, getUserProfile } from "@saveany/db";

/** 获取当前登录用户（Route Handler 用）；未登录返回 null */
export async function getAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** 构建 401 响应 */
export function unauthorized(message = "请先登录") {
  return NextResponse.json({ error: message }, { status: 401 });
}

/** 获取用户业务资料（users 表行）——用 service_role 读取，规避 RLS 对服务端读取的干扰 */
export async function getProfile(userId: string) {
  const env = getSupabaseEnv();
  const admin = createAdminClient(env);
  return getUserProfile(admin, userId);
}