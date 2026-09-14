/** 环境变量约定：从 process.env 读取 Supabase 配置 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function getSupabaseEnv(env: NodeJS.ProcessEnv = process.env): SupabaseEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !anonKey) {
    throw new Error("缺少 Supabase 配置: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return { url, anonKey, serviceRoleKey };
}