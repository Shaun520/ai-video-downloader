"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DashboardIcon, LogoutIcon, MenuIcon, ModelIcon, OrdersIcon, UsersIcon } from "@/lib/icons";

const NAV_ITEMS = [
  { href: "/", label: "概览", icon: DashboardIcon, exact: true },
  { href: "/users", label: "用户管理", icon: UsersIcon },
  { href: "/orders", label: "订单管理", icon: OrdersIcon },
  { href: "/settings", label: "模型配置", icon: ModelIcon },
];

const TITLES: Record<string, string> = {
  "/": "概览",
  "/users": "用户管理",
  "/orders": "订单管理",
  "/settings": "模型配置",
};

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 h-16 shrink-0">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
        AI
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-white">AI 视频下载器</div>
        <div className="text-[11px] text-slate-400">管理后台</div>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const active = NAV_ITEMS.find(
    (item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href))
  );
  const title = active?.label ?? TITLES[pathname] ?? "管理后台";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <nav className="flex flex-col flex-1 gap-1 px-3 pt-2" aria-label="主导航">
      {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href);
        return (
          <a
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-slate-300 transition-colors",
              "hover:bg-white/5 hover:text-white",
              isActive && "bg-primary/90 text-white hover:bg-primary"
            )}
          >
            <Icon width={17} height={17} />
            {label}
          </a>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* 桌面侧边栏 */}
      <aside className="hidden md:flex md:w-56 md:flex-col bg-bg-sidebar fixed inset-y-0 left-0 z-30">
        <Brand />
        {sidebar}
        <div className="mt-auto p-4">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleLogout();
            }}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-slate-400 rounded-lg hover:bg-white/5 hover:text-white transition-colors"
          >
            <LogoutIcon width={16} height={16} />
            退出登录
          </a>
        </div>
      </aside>

      {/* 移动端侧边栏 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex w-60 flex-col bg-bg-sidebar h-full">
            <Brand />
            {sidebar}
            <div className="mt-auto p-4">
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  handleLogout();
                }}
                className="flex items-center gap-2 px-3 py-2 text-[13px] text-slate-400 rounded-lg hover:bg-white/5 hover:text-white"
              >
                <LogoutIcon width={16} height={16} />
                退出登录
              </a>
            </div>
          </aside>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex flex-col flex-1 md:pl-56">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-white/90 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-border-light"
            onClick={() => setMobileOpen(true)}
            aria-label="打开菜单"
          >
            <MenuIcon />
          </button>
          <h1 className="text-[15px] font-semibold text-text-primary">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-text-muted">管理员</span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-secondary hover:bg-border-light transition-colors"
            >
              <LogoutIcon width={15} height={15} />
              退出
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}