import type { Metadata } from "next";
import AuthPage from "@/components/auth-form";

export const metadata: Metadata = {
  title: "注册",
  description: "注册 AI 视频下载器账号，免费使用 AI 视频总结、思维导图与字幕导出。",
  alternates: { canonical: "/register" },
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <AuthPage mode="register" />;
}
