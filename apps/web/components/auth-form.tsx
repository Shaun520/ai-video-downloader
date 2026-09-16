"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  login,
  completeRegister,
  sendRegisterCode,
} from "@/lib/auth-actions";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AuthFormContent({ mode }: { mode: "login" | "register" }) {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const isLogin = mode === "login";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();

  // 注册模式：邮箱状态（发验证码用）+ 60s 倒计时
  const [email, setEmail] = useState("");
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      setError("");
      setNotice("");
      const res = isLogin ? await login(formData) : await completeRegister(formData);
      if (res?.error) setError(res.error);
      if (res?.success) setNotice(res.success);
    });
  }

  async function handleSendCode() {
    const clean = email.trim().toLowerCase();
    if (countdown > 0) return;
    if (!EMAIL_RE.test(clean)) {
      setError("请输入正确的邮箱地址");
      return;
    }
    setError("");
    setNotice("");
    startTransition(async () => {
      const res = await sendRegisterCode(clean);
      if (res?.error) setError(res.error);
      if (res?.success) {
        setNotice(res.success);
        setCountdown(60);
      }
    });
  }

  const sendDisabled = countdown > 0 || isPending;

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
          S
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          {isLogin ? "欢迎回来" : "创建账号"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {isLogin ? "登录后管理你的下载与 AI 总结记录" : "永久免费，无需信用卡即可开始"}
        </p>
      </div>

      <form action={onSubmit} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-700">
            邮箱
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-100"
          />
        </div>

        {!isLogin && (
          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-zinc-700">
              邮箱验证码
            </label>
            <div className="flex gap-2">
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="8 位验证码"
                className="h-11 flex-1 rounded-lg border border-zinc-200 bg-white px-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-100"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendDisabled}
                className="h-11 shrink-0 rounded-lg bg-zinc-100 px-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              验证码 5 分钟内有效；若未收到请检查垃圾箱
            </p>
          </div>
        )}

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-zinc-700">
            密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={6}
            placeholder="••••••••"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-100"
          />
        </div>

        {!isLogin && (
          <div>
            <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-zinc-700">
              确认密码
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              placeholder="再次输入密码"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-100"
            />
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "请稍候…" : isLogin ? "登录" : "注册"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        {isLogin ? (
          <>
            还没有账号？{" "}
            <Link href="/register" className="font-medium text-zinc-900 hover:underline">
              免费注册
            </Link>
          </>
        ) : (
          <>
            已有账号？{" "}
            <Link href="/login" className="font-medium text-zinc-900 hover:underline">
              直接登录
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Suspense fallback={null}>
        <AuthFormContent mode={mode} />
      </Suspense>
    </div>
  );
}