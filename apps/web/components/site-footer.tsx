import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-secondary">
              AI 视频下载器 —— 多平台视频解析下载与 AI 总结工具。免费使用，注重隐私。
            </p>
          </div>
          <nav className="flex gap-6 text-sm text-text-secondary" aria-label="页脚导航">
            <a href="#features" className="transition-colors hover:text-text-primary">功能</a>
            <a href="#how" className="transition-colors hover:text-text-primary">使用教程</a>
            {/* <a href="#pricing" className="transition-colors hover:text-text-primary">定价</a> */}
            <Link href="/login" className="transition-colors hover:text-text-primary">登录</Link>
          </nav>
        </div>
        <div className="mt-8 flex flex-col items-start gap-1 border-t border-border-light pt-6 text-xs text-text-muted">
          <p>© {new Date().getFullYear()} AI 视频下载器。仅供合法用途，请尊重各平台版权与创作者权益。</p>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-text-primary">
            湘ICP备2024096812号-3
          </a>
        </div>
      </div>
    </footer>
  );
}