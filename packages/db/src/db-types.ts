/** DB 行类型（snake_case，对应 Supabase 表结构） */

export interface DbUser {
  id: string;
  email: string;
  is_vip: boolean;
  vip_expire_at: string | null;
  daily_summary_count: number;
  last_summary_date: string | null;
  created_at: string;
  updated_at?: string;
}

export interface DbOrder {
  id: string;
  order_no: string;
  user_id: string;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "canceled" | "refunded";
  plan_type: "monthly" | "yearly";
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at?: string;
}

/** DB 行 → 共享类型转换 */
export function toUserProfile(row: DbUser) {
  return {
    id: row.id,
    email: row.email,
    isVip: row.is_vip,
    vipExpireAt: row.vip_expire_at ?? undefined,
    dailySummaryCount: row.daily_summary_count,
    lastSummaryDate: row.last_summary_date ?? undefined,
    createdAt: row.created_at,
  };
}

export function toOrder(row: DbOrder) {
  return {
    id: row.id,
    orderNo: row.order_no,
    userId: row.user_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    planType: row.plan_type,
    stripeSessionId: row.stripe_session_id ?? undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    paidAt: row.paid_at ?? undefined,
    createdAt: row.created_at,
  };
}