import Link from "next/link";
import { Logo } from "./logo";

interface SiteHeaderProps {
  userEmail?: string;
  isVip?: boolean;
}

/** 顶部导航（服务端渲染，读取 cookie 判断登录态） */
export function SiteHeader({ userEmail, isVip }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-8 text-sm text-text-secondary md:flex" aria-label="主导航">
          <a href="#features" className="transition-colors hover:text-text-primary">功能</a>
          <a href="#how" className="transition-colors hover:text-text-primary">使用教程</a>
          <a href="#pricing" className="transition-colors hover:text-text-primary">定价</a>
          <a href="#platforms" className="transition-colors hover:text-text-primary">支持平台</a>
        </nav>

        <div className="flex items-center gap-3">
          {userEmail ? (
            <>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                {isVip ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">VIP</span>
                    {userEmail}
                  </span>
                ) : (
                  userEmail
                )}
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="rounded-lg border border-border px-3.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-zinc-50 hover:text-text-primary cursor-pointer"
                >
                  退出
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                登录
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
              >
                免费注册
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}