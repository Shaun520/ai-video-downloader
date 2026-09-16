"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, getSupabaseEnv } from "@saveany/db";

export type AuthResult = { error?: string; success?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 邮箱+密码登录 */
export async function login(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "/");

  if (!email || !password) {
    return { error: "请输入邮箱和密码" };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg =
      error.message === "Invalid login credentials"
        ? "邮箱或密码错误"
        : error.message;
    return { error: msg };
  }

  redirect(next);
}

/** 发送注册邮箱验证码（Supabase 原生 OTP；同一邮箱 60s 限发一次，防刷） */
const otpCoolDown = new Map<string, number>(); // email -> 上次发送时间戳
const OTP_COOLDOWN_MS = 60_000;

export async function sendRegisterCode(email: string): Promise<AuthResult> {
  const clean = email.trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) {
    return { error: "请输入正确的邮箱地址" };
  }

  // 已注册邮箱直接去登录（避免验证通过后覆盖老密码）
  try {
    const admin = createAdminClient(getSupabaseEnv());
    const { data: existing } = await admin
      .from("users")
      .select("id")
      .eq("email", clean)
      .maybeSingle();
    if (existing) {
      return { error: "该邮箱已注册，请直接登录" };
    }
  } catch {
    // 查询失败不阻断发送流程，交由后续校验兜底
  }

  // 服务端防抖：60s 内同一邮箱只发一次
  const now = Date.now();
  const last = otpCoolDown.get(clean);
  if (last && now - last < OTP_COOLDOWN_MS) {
    const wait = Math.ceil((OTP_COOLDOWN_MS - (now - last)) / 1000);
    return { error: `发送太频繁，请 ${wait} 秒后再试` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback`,
    },
  });
  if (error) {
    return { error: error.message };
  }
  otpCoolDown.set(clean, now);
  return { success: `验证码已发送至 ${clean}，5 分钟内有效，请查收（含垃圾箱）` };
}

/** 邮箱验证码 + 密码注册：校验 OTP → 补设密码 → 自动登录进入首页 */
export async function completeRegister(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const code = String(formData.get("code") || "").trim();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirmPassword") || "");

  if (!email || !code) return { error: "请输入邮箱和验证码" };
  if (!EMAIL_RE.test(email)) return { error: "请输入正确的邮箱地址" };
  if (password.length < 6) return { error: "密码至少 6 位" };
  if (password !== confirm) return { error: "两次输入的密码不一致" };

  // 验证码校验通过 = 邮箱已确认；若邮箱尚未注册，Supabase 会在此自动创建账号（email_confirmed_at=now）
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (verifyError) {
    return { error: "验证码错误或已过期，请重新获取" };
  }

  // 当前会话是刚验证的邮箱所有者，补设登录密码
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return { error: updateError.message };
  }

  redirect("/");
}

/** 登出 */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}