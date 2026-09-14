import { toOrder } from "@saveany/db";
import { AdminShell } from "@/components/admin-shell";
import { getAdminDb } from "@/lib/db";
import { formatAmount, formatDate } from "@/lib/format";
import { OrdersIcon, UsersIcon, CrownIcon, TrendingUpIcon, ExternalLinkIcon } from "@/lib/icons";
import type { Order } from "@saveany/shared";

export const dynamic = "force-dynamic";

async function getStats() {
  const db = getAdminDb();
  const now = new Date().toISOString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [userCount, vipCount, todayNew, ordersCount, revenue, recentOrders] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }),
    db.from("users").select("id", { count: "exact", head: true }).eq("is_vip", true).gt("vip_expire_at", now),
    db.from("users").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
    db.from("orders").select("id", { count: "exact", head: true }),
    db.from("orders").select("amount").eq("status", "paid"),
    db.from("orders").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  const revenueTotal =
    (revenue.data as Array<{ amount: number }> | null)?.reduce((sum, o) => sum + o.amount, 0) ?? 0;

  return {
    totalUsers: userCount.count ?? 0,
    vipUsers: vipCount.count ?? 0,
    todayNew: todayNew.count ?? 0,
    totalOrders: ordersCount.count ?? 0,
    revenue: revenueTotal,
    recentOrders: ((recentOrders.data ?? []) as Parameters<typeof toOrder>[0][]).map(toOrder),
  };
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ComponentType<{ width?: number; height?: number; className?: string }>;
}) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-border bg-white p-5 shadow-sm">
      <div>
        <p className="text-[13px] text-text-muted">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
        {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
        <Icon width={20} height={20} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Order["status"] }) {
  const map: Record<Order["status"], { label: string; cls: string }> = {
    pending: { label: "待支付", cls: "bg-warning/10 text-warning" },
    paid: { label: "已支付", cls: "bg-success/10 text-success" },
    canceled: { label: "已取消", cls: "bg-border-light text-text-muted" },
    refunded: { label: "已退款", cls: "bg-danger/10 text-danger" },
  };
  const item = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${item.cls}`}>
      {item.label}
    </span>
  );
}

export default async function OverviewPage() {
  const stats = await getStats();

  return (
    <AdminShell>
      <div className="space-y-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="总用户数" value={stats.totalUsers} icon={UsersIcon} />
          <StatCard label="VIP 用户" value={stats.vipUsers} icon={CrownIcon} />
          <StatCard label="今日新增" value={stats.todayNew} hint="注册新用户" icon={TrendingUpIcon} />
          <StatCard label="订单总数" value={stats.totalOrders} icon={OrdersIcon} />
          <StatCard label="累计收入" value={formatAmount(stats.revenue)} icon={OrdersIcon} />
        </div>

        {/* 最近订单 */}
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
            <h2 className="text-[15px] font-semibold text-text-primary">最近订单</h2>
            <a
              href="/orders"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:text-primary-dark"
            >
              <ExternalLinkIcon width={15} height={15} />
              查看全部
            </a>
          </div>
          {stats.recentOrders.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-text-muted">暂无订单</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-border-light text-xs text-text-muted">
                    <th className="px-5 py-3 font-medium">订单号</th>
                    <th className="px-5 py-3 font-medium">用户 ID</th>
                    <th className="px-5 py-3 font-medium">套餐</th>
                    <th className="px-5 py-3 font-medium">金额</th>
                    <th className="px-5 py-3 font-medium">状态</th>
                    <th className="px-5 py-3 font-medium">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentOrders.map((o) => (
                    <tr key={o.id} className="border-b border-border-light last:border-0 hover:bg-border-light/50">
                      <td className="px-5 py-3 font-mono text-[12.5px] text-text-secondary">{o.orderNo}</td>
                      <td className="px-5 py-3 font-mono text-[12.5px] text-text-muted">{o.userId.slice(0, 12)}…</td>
                      <td className="px-5 py-3 text-text-secondary">
                        {o.planType === "monthly" ? "月度会员" : "年度会员"}
                      </td>
                      <td className="px-5 py-3 font-medium tabular-nums text-text-primary">
                        {formatAmount(o.amount, o.currency)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-5 py-3 text-xs text-text-muted">{formatDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}