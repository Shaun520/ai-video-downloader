import type { Metadata } from "next";
import AuthPage from "@/components/auth-form";

export const metadata: Metadata = {
  title: "登录",
  description: "登录 AI 视频下载器，管理你的下载记录与 AI 总结。",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <AuthPage mode="login" />;
}
