import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 视频下载器 - 多平台视频解析下载与 AI 总结",
  description:
    "粘贴链接即可解析下载国内外主流平台视频；AI 一键生成内容总结、思维导图与字幕，无需安装任何软件。",
  keywords: ["视频下载", "视频解析", "AI 总结", "B站下载", "YouTube下载", "抖音去水印"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}