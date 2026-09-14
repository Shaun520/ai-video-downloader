/** 展示格式化工具 */

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateOnly(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("zh-CN");
}

/** amount 单位为“分”（与后端 PLANS 一致：990 = ¥9.90） */
export function formatAmount(amount: number, currency = "cny"): string {
  const symbol = currency === "usd" ? "$" : "¥";
  return `${symbol}${(amount / 100).toFixed(2)}`;
}

export const VIP_STATUS_TEXT: Record<string, string> = {
  monthly: "月度会员",
  yearly: "年度会员",
};

export const ORDER_STATUS_TEXT: Record<string, string> = {
  pending: "待支付",
  paid: "已支付",
  canceled: "已取消",
  refunded: "已退款",
};

export const ORDER_STATUS_TONE: Record<string, "warning" | "success" | "muted" | "danger"> = {
  pending: "warning",
  paid: "success",
  canceled: "muted",
  refunded: "danger",
};

/** VIP 是否仍在有效期内 */
export function isVipActive(isVip: boolean, expireAt?: string | null): boolean {
  if (!isVip || !expireAt) return false;
  return new Date(expireAt) > new Date();
}