import Link from "next/link";

/** 站点 Logo（文字标） */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
        AI
      </span>
      <span className="text-lg font-semibold tracking-tight text-text-primary">
        AI 视频下载器
      </span>
    </Link>
  );
}