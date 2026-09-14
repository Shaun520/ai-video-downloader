"use client";

import { useCallback, useEffect, useState } from "react";
import { FREE_DAILY_SUMMARY_LIMIT, type UserProfile } from "@saveany/shared";
import { CrownIcon, ResetIcon, SearchIcon, SpinnerIcon, ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { formatDate, formatDateOnly, isVipActive } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

interface ListResponse {
  data: UserProfile[];
  total: number;
  page: number;
  pageSize: number;
}

const DURATIONS = [
  { label: "1 个月", months: 1 },
  { label: "3 个月", months: 3 },
  { label: "6 个月", months: 6 },
  { label: "12 个月", months: 12 },
] as const;

function VipBadge({ user }: { user: UserProfile }) {
  const active = isVipActive(user.isVip, user.vipExpireAt);
  if (!active) {
    return (
      <span className="inline-flex items-center rounded-full bg-border-light px-2 py-0.5 text-xs text-text-muted">
        普通用户
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
      <CrownIcon width={12} height={12} />
      VIP
    </span>
  );
}

function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between border-t border-border-light px-5 py-3">
      <p className="text-xs text-text-muted">
        共 <span className="tabular-nums">{total}</span> 位用户 · 第{" "}
        <span className="tabular-nums">{page + 1}</span> / {totalPages} 页
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-border-light disabled:opacity-40"
        >
          <ChevronLeftIcon width={14} height={14} />
          上一页
        </button>
        <button
          type="button"
          disabled={page >= totalPages - 1}
          onClick={() => onChange(page + 1)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-border-light disabled:opacity-40"
        >
          下一页
          <ChevronRightIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function VipModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserProfile;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"duration" | "custom" | "cancel">("duration");
  const [months, setMonths] = useState(1);
  const [date, setDate] = useState(
    (user.vipExpireAt && user.vipExpireAt.slice(0, 10)) || ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      let expireAt: string | null = null;
      if (mode === "duration") {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        expireAt = d.toISOString();
      } else if (mode === "custom") {
        if (!date) {
          setError("请选择日期");
          return;
        }
        const d = new Date(`${date}T23:59:59+08:00`);
        if (Number.isNaN(d.getTime())) {
          setError("日期无效");
          return;
        }
        expireAt = d.toISOString();
      }
      // mode === "cancel" → expireAt = null

      const res = await fetch(`/api/users/${user.id}/vip`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expireAt }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "保存失败");
      onSaved(mode === "cancel" ? "已取消 VIP" : "VIP 设置已保存");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`设置 ${user.email} 的 VIP`}
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
          <h3 className="text-[15px] font-semibold text-text-primary">设置 VIP</h3>
          <span className="font-mono text-xs text-text-muted">{user.id.slice(0, 12)}…</span>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg bg-border-light/60 px-3 py-2.5 text-[13px] text-text-secondary break-all">
            {user.email}
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-1.5 block text-[13px] font-medium text-text-secondary">
              赠送时长
            </legend>
            <div className="grid grid-cols-4 gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.months}
                  type="button"
                  onClick={() => {
                    setMode("duration");
                    setMonths(d.months);
                  }}
                  aria-pressed={mode === "duration" && months === d.months}
                  className={cn(
                    "h-9 rounded-lg border border-border text-[13px] text-text-secondary transition-colors",
                    mode === "duration" && months === d.months
                      ? "border-primary bg-primary-light text-primary"
                      : "hover:bg-border-light"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="custom-date" className="mb-1.5 block text-[13px] font-medium text-text-secondary">
              自定义到期日
            </label>
            <input
              id="custom-date"
              type="date"
              value={date}
              onChange={(e) => {
                setMode("custom");
                setDate(e.target.value);
              }}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {isVipActive(user.isVip, user.vipExpireAt) && (
            <button
              type="button"
              onClick={() => setMode("cancel")}
              className={cn(
                "text-[13px] text-danger hover:underline",
                mode === "cancel" && "font-medium underline"
              )}
            >
              取消 VIP（设为普通用户）
            </button>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-light px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] text-text-secondary hover:bg-border-light"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          >
            {saving && <SpinnerIcon width={14} height={14} />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function UsersClient() {
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [vipUser, setVipUser] = useState<UserProfile | null>(null);

  const load = useCallback(async (p: number, kw: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), per_page: String(PAGE_SIZE) });
      if (kw) params.set("keyword", kw);
      const res = await fetch(`/api/users?${params.toString()}`);
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
    load(page, search);
  }, [load, page, search]);

  async function handleReset(user: UserProfile) {
    const res = await fetch(`/api/users/${user.id}/reset`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setNotice("");
      setError(json.error || "重置失败");
      return;
    }
    setError("");
    setNotice(`已重置 ${user.email} 的每日次数`);
    load(page, search);
    setTimeout(() => setNotice(""), 3000);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(keyword);
  }

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={submitSearch} className="relative w-full sm:max-w-xs">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <SearchIcon width={15} height={15} />
          </span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索邮箱或用户 ID"
            className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </form>
        {notice && <span className="text-[13px] text-success">{notice}</span>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {/* 用户表格 */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
            <SpinnerIcon width={16} height={16} />
            加载中…
          </div>
        ) : list.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-text-muted">未找到匹配的用户</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-border-light text-xs text-text-muted">
                  <th className="px-5 py-3 font-medium">用户</th>
                  <th className="px-5 py-3 font-medium">VIP 状态</th>
                  <th className="px-5 py-3 font-medium">VIP 到期</th>
                  <th className="px-5 py-3 font-medium">今日次数</th>
                  <th className="px-5 py-3 font-medium">最后总结</th>
                  <th className="px-5 py-3 font-medium">注册时间</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className="border-b border-border-light last:border-0 hover:bg-border-light/50">
                    <td className="px-5 py-3">
                      <div className="text-text-primary">{u.email}</div>
                      <div className="mt-0.5 font-mono text-xs text-text-muted">{u.id}</div>
                    </td>
                    <td className="px-5 py-3">
                      <VipBadge user={u} />
                    </td>
                    <td className="px-5 py-3 text-text-secondary">{formatDateOnly(u.vipExpireAt)}</td>
                    <td className="px-5 py-3">
                      <span className="tabular-nums text-text-secondary">{u.dailySummaryCount}</span>
                      <span className="text-xs text-text-muted"> / {FREE_DAILY_SUMMARY_LIMIT}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-text-muted">{formatDateOnly(u.lastSummaryDate)}</td>
                    <td className="px-5 py-3 text-xs text-text-muted">{formatDate(u.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setVipUser(u)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:border-primary hover:text-primary"
                        >
                          <CrownIcon width={13} height={13} />
                          VIP
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReset(u)}
                          title="重置每日免费总结次数"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-secondary hover:border-primary hover:text-primary"
                        >
                          <ResetIcon width={13} height={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && <Pagination page={page} total={total} onChange={setPage} />}
      </div>

      {vipUser && (
        <VipModal
          user={vipUser}
          onClose={() => setVipUser(null)}
          onSaved={(msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(""), 3000);
            load(page, search);
          }}
        />
      )}
    </div>
  );
}