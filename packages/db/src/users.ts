/** users 数据访问（Admin 走 service_role；用户侧走 RLS） */
import type { Db } from "./client.js";
import type { DbUser } from "./db-types.js";

/** 服务端按邮箱查用户（Admin） */
export async function adminGetUserByEmail(db: Db, email: string): Promise<DbUser | null> {
  const { data } = await db.from("users").select("*").eq("email", email).maybeSingle();
  return (data as DbUser | null) ?? null;
}

/** 服务端按 id 查用户（Admin） */
export async function adminGetUserById(db: Db, userId: string): Promise<DbUser | null> {
  const { data } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  return (data as DbUser | null) ?? null;
}

/** 用户侧按自己 id 查资料（受 RLS 约束） */
export async function getUserProfile(db: Db, userId: string): Promise<DbUser | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return (data as DbUser | null) ?? null;
}

/** Admin：用户列表 */
export async function adminListUsers(
  db: Db,
  opts: { page?: number; pageSize?: number; keyword?: string } = {}
): Promise<{ users: DbUser[]; total: number }> {
  const { page = 0, pageSize = 20, keyword } = opts;
  let query = db.from("users").select("id,email,is_vip,vip_expire_at,daily_summary_count,last_summary_date,created_at", { count: "exact" });
  if (keyword) {
    query = query.or(`email.ilike.%${keyword}%,id.ilike.%${keyword}%`);
  }
  query = query.order("created_at", { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
  const { data, error, count } = await query;
  if (error) throw new Error(`查询用户失败: ${error.message}`);
  return { users: (data as DbUser[]) || [], total: count ?? 0 };
}

/** Admin：设置 VIP（expireAt 传 null 表示取消 VIP） */
export async function adminSetVip(db: Db, userId: string, vipExpireAt: string | null): Promise<void> {
  const { error } = await db
    .from("users")
    .update({ is_vip: !!vipExpireAt, vip_expire_at: vipExpireAt, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`更新 VIP 失败: ${error.message}`);
}

/** Admin：重置每日免费次数 */
export async function adminResetDailyCount(db: Db, userId: string): Promise<void> {
  const { error } = await db
    .from("users")
    .update({ daily_summary_count: 0, last_summary_date: null, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`重置次数失败: ${error.message}`);
}