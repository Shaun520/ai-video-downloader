import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardMinimal() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">工作台</h1>
            <p className="mt-1 text-sm text-zinc-500">
              已登录：{user?.email}
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <button className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
              退出登录
            </button>
          </form>
        </div>
        <div className="mt-8 rounded-xl bg-zinc-50 p-6 text-center text-sm text-zinc-500">
          阶段 3 认证链路验证通过。完整工作台将在阶段 4 上线。
        </div>
        <div className="mt-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}