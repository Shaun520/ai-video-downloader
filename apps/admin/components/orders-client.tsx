"use client";

import { useCallback, useEffect, useState } from "react";
import type { Order, OrderStatus, PlanType } from "@saveany/shared";
import { SpinnerIcon, FilterIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/lib/icons";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

type StatusKey = "all" | OrderStatus;

const STATUS_TABS: Array<{ key: StatusKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待支付" },
  { key: "paid", label: "已支付" },
  { key: "canceled", label: "已取消" },
  { key: "refunded", label: "已退款" },
];

const STATUS_META: Record<OrderStatus, { cls: string }> = {
  pending: { cls: "bg-warning/10 text-warning" },
  paid: { cls: "bg-success/10 text-success" },
  canceled: { cls: "bg-border-light text-text-muted" },
  refunded: { cls: "bg-danger/10 text-danger" },
};

const STATUS_TEXT: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  canceled: "已取消",
  refunded: "已退款",
};

const PLAN_TEXT: Record<PlanType, string> = {
  monthly: "月度会员",
  yearly: "年度会员",
};

interface ListResponse {
  data: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export function OrdersClient() {
  const [status, setStatus] = useState<StatusKey>("all");
  const [userId, setUserId] = useState("");
  const [appliedUserId, setAppliedUserId] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (p: number, st: StatusKey, uid: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), per_page: String(PAGE_SIZE) });
      if (st !== "all") params.set("status", st);
      if (uid) params.set("user_id", uid);
      const res = await fetch(`/api/orders?${params.toString()}`);
      const json = (await res.json().catch(() => ({}))) as Partial<ListResponse> & { error?: string };
      if (!res.ok) throw new Error(json.error || "加载失败");
      setList(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, status, appliedUserId);
  }, [load, page, status, appliedUserId]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {/* 状态筛选 + 用户筛选 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="订单状态筛选">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => {
                setStatus(t.key);
                setPage(0);
              }}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-3.5 text-[13px] transition-colors",
                status === t.key
                  ? "bg-primary text-white"
                  : "bg-white text-text-secondary border border-border hover:bg-border-light"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setAppliedUserId(userId.trim());
          }}
          className="relative w-full lg:w-72"
        >
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <SearchIcon width={15} height={15} />
          </span>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="按用户 ID 筛选"
            className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </form>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
            <SpinnerIcon width={16} height={16} />
            加载中…
          </div>
        ) : list.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-text-muted">暂无订单</div>
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
                  <th className="px-5 py-3 font-medium">Stripe Session</th>
                  <th className="px-5 py-3 font-medium">支付时间</th>
                  <th className="px-5 py-3 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const st = STATUS_META[o.status];
                  return (
                    <tr key={o.id} className="border-b border-border-light last:border-0 hover:bg-border-light/50">
                      <td className="px-5 py-3 font-mono text-[12.5px] text-text-secondary">{o.orderNo}</td>
                      <td className="px-5 py-3 font-mono text-[12.5px] text-text-muted">{o.userId.slice(0, 12)}…</td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary">
                          <FilterIcon width={11} height={11} className="mr-1" />
                          {PLAN_TEXT[o.planType]}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium tabular-nums text-text-primary">
                        {formatAmount(o.amount, o.currency)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>
                          {STATUS_TEXT[o.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px] text-text-muted">
                        {o.stripeSessionId ? o.stripeSessionId.slice(0, 20) + "…" : "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-text-muted">{formatDate(o.paidAt)}</td>
                      <td className="px-5 py-3 text-xs text-text-muted">{formatDate(o.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && (
          <div className="flex items-center justify-between border-t border-border-light px-5 py-3">
            <p className="text-xs text-text-muted">
              共 <span className="tabular-nums">{total}</span> 笔订单 · 第{" "}
              <span className="tabular-nums">{page + 1}</span> / {totalPages} 页
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-border-light disabled:opacity-40"
              >
                <ChevronLeftIcon width={14} height={14} />
                上一页
              </button>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-border-light disabled:opacity-40"
              >
                下一页
                <ChevronRightIcon width={14} height={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}