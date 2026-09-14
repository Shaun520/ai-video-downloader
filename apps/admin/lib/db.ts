/** 服务端 Supabase service_role 客户端（仅限 Admin API 使用） */
import { createAdminClient, getSupabaseEnv } from "@saveany/db";

export function getAdminDb() {
  return createAdminClient(getSupabaseEnv());
}