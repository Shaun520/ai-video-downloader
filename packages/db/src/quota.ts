/**
 * quota.ts — 每日免费次数 / VIP 逻辑（复刻原 backend/database.py 的 check_and_increment_summary）
 * 使用用户上下文客户端（RLS 允许读/改自己的行）。
 */
import type { Db } from "./client.js";
import { FREE_DAILY_SUMMARY_LIMIT } from "@saveany/shared";
import type { DbUser } from "./db-types.js";

export interface QuotaResult {
  allowed: boolean;
  /** -1 表示 VIP 无限次 */
  remaining: number;
  message?: string;
}

function todayStr(): string {
  // 服务器在北京时区以外以 UTC 为准会对每日计数有偏差，这里统一按 UTC 日期
  return new Date().toISOString().slice(0, 10);
}

/**
 * 检查并自增总结次数。
 * - 未找到用户 → 拒绝
 * - VIP 且未过期 → 无限（remaining = -1）
 * - 免费用户 → 每日上限 FREE_DAILY_SUMMARY_LIMIT
 */
export async function checkAndIncrementSummary(db: Db, userId: string): Promise<QuotaResult> {
  const today = todayStr();

  const { data } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  const user = data as DbUser | null;
  if (!user) return { allowed: false, remaining: 0, message: "用户不存在，请重新登录" };

  // VIP 有效期内：无限次
  if (user.is_vip && user.vip_expire_at && new Date(user.vip_expire_at) > new Date()) {
    return { allowed: true, remaining: -1 };
  }

  // 新的一天：重置为 1
  if (user.last_summary_date !== today) {
    const { error } = await db
      .from("users")
      .update({ daily_summary_count: 1, last_summary_date: today, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) return { allowed: false, remaining: 0, message: error.message };
    return { allowed: true, remaining: FREE_DAILY_SUMMARY_LIMIT - 1 };
  }

  const current = user.daily_summary_count;
  if (current >= FREE_DAILY_SUMMARY_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      message: `今日免费 AI 总结次数已用完（每日 ${FREE_DAILY_SUMMARY_LIMIT} 次），开通 VIP 可无限使用`,
    };
  }

  const { error } = await db
    .from("users")
    .update({ daily_summary_count: current + 1, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { allowed: false, remaining: 0, message: error.message };
  return { allowed: true, remaining: FREE_DAILY_SUMMARY_LIMIT - current - 1 };
}