"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockIcon, SpinnerIcon } from "@/lib/icons";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "登录失败");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white text-sm font-bold">
          AI
        </div>
        <h1 className="text-xl font-semibold text-text-primary">AI 视频下载器 - 管理后台</h1>
        <p className="mt-1.5 text-sm text-text-muted">请输入管理员密码后继续</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-text-secondary">
            管理员密码
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              <LockIcon width={16} height={16} />
            </span>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="h-11 w-full rounded-lg border border-border bg-white pl-10 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <SpinnerIcon width={16} height={16} className="text-white" />}
          登录
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-main px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}