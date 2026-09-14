/** orders 数据访问（Admin + 支付回调） */
import type { Db } from "./client.js";
import type { DbOrder } from "./db-types.js";

/** Admin：订单列表 */
export async function adminListOrders(
  db: Db,
  opts: { page?: number; pageSize?: number; userId?: string; status?: string } = {}
): Promise<{ orders: DbOrder[]; total: number }> {
  const { page = 0, pageSize = 20, userId, status } = opts;
  let query = db.from("orders").select("*", { count: "exact" });
  if (userId) query = query.eq("user_id", userId);
  if (status) query = query.eq("status", status);
  query = query.order("created_at", { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
  const { data, error, count } = await query;
  if (error) throw new Error(`查询订单失败: ${error.message}`);
  return { orders: (data as DbOrder[]) || [], total: count ?? 0 };
}

/** Admin/服务端：按订单号查 */
export async function adminGetOrderByNo(db: Db, orderNo: string): Promise<DbOrder | null> {
  const { data } = await db.from("orders").select("*").eq("order_no", orderNo).maybeSingle();
  return (data as DbOrder | null) ?? null;
}

/** 服务端：按 stripe session id 查 pending 订单（支付回调幂等） */
export async function adminGetPendingBySession(db: Db, sessionId: string): Promise<DbOrder | null> {
  const { data } = await db
    .from("orders")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .eq("status", "pending")
    .maybeSingle();
  return (data as DbOrder | null) ?? null;
}

/** 服务端：创建订单（支付前占位） */
export async function adminCreateOrder(
  db: Db,
  input: { orderNo: string; userId: string; amount: number; currency?: string; planType: "monthly" | "yearly" }
): Promise<DbOrder> {
  const { data, error } = await db
    .from("orders")
    .insert({
      order_no: input.orderNo,
      user_id: input.userId,
      amount: input.amount,
      currency: input.currency || "cny",
      plan_type: input.planType,
    })
    .select("*")
    .single();
  if (error) throw new Error(`创建订单失败: ${error.message}`);
  return data as DbOrder;
}

/** 服务端：绑定 stripe session */
export async function adminUpdateOrderSession(db: Db, orderNo: string, sessionId: string): Promise<void> {
  const { error } = await db
    .from("orders")
    .update({ stripe_session_id: sessionId, updated_at: new Date().toISOString() })
    .eq("order_no", orderNo);
  if (error) throw new Error(`绑定支付会话失败: ${error.message}`);
}

/** 支付成功：更新订单 + 激活 VIP（幂等：仅 pending → paid） */
export async function adminCompleteOrder(
  db: Db,
  sessionId: string,
  paymentIntentId: string
): Promise<DbOrder | null> {
  const order = await adminGetPendingBySession(db, sessionId);
  if (!order) return null;

  const now = new Date();

  const userRes = await db.from("users").select("*").eq("id", order.user_id).maybeSingle();
  const user = userRes.data as { vip_expire_at?: string | null } | null;

  let base = now;
  if (user?.vip_expire_at) {
    const expire = new Date(user.vip_expire_at);
    if (expire > now) base = expire; // 续费：在现有到期时间上叠加
  }
  const newExpire =
    order.plan_type === "yearly"
      ? new Date(base.getTime() + 365 * 24 * 3600 * 1000)
      : new Date(base.setMonth(base.getMonth() + 1));

  // 更新订单
  const { error: orderErr } = await db
    .from("orders")
    .update({
      status: "paid",
      stripe_payment_intent_id: paymentIntentId,
      paid_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", order.id);
  if (orderErr) throw new Error(`订单更新失败: ${orderErr.message}`);

  // 更新用户 VIP
  const { error: userErr } = await db
    .from("users")
    .update({
      is_vip: true,
      vip_expire_at: newExpire.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", order.user_id);
  if (userErr) throw new Error(`VIP 激活失败: ${userErr.message}`);

  return { ...order, status: "paid" };
}