import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 视频下载器 - 管理后台",
  description: "AI 视频下载器 多平台视频解析下载与 AI 总结 - 管理后台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}