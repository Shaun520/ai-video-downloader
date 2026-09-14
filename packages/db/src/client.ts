/** Supabase 客户端工厂 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseEnv } from "./env.js";

export type Db = SupabaseClient;

/** service_role 客户端：绕过 RLS，仅限服务端/Admin 使用 */
export function createAdminClient(env: SupabaseEnv): SupabaseClient {
  if (!env.serviceRoleKey) throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY");
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** anon 客户端：以用户身份访问（配合用户 JWT，受 RLS 约束） */
export function createUserClient(env: SupabaseEnv, accessToken?: string): SupabaseClient {
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (accessToken) {
    client.auth.setSession({ access_token: accessToken, refresh_token: "" });
  }
  return client;
}