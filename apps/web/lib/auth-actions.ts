"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthResult = { error?: string; success?: string };

/** 邮箱+密码登录 */
export async function login(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "/dashboard");

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

/** 邮箱+密码注册 */
export async function register(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "请输入邮箱和密码" };
  }
  if (password.length < 6) {
    return { error: "密码至少 6 位" };
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // 由 Supabase 自动为 auth.users 创建行，handle_new_user 触发器自动建 users 资料
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback`,
    },
  });
  if (error) {
    return { error: error.message };
  }

  return { success: "注册成功，请查收邮箱完成验证（或直接返回登录）" };
}

/** 登出 */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}