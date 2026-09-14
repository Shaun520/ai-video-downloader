const PLATFORMS = [
  { name: "YouTube", tag: "youtube" },
  { name: "哔哩哔哩", tag: "bilibili" },
  { name: "抖音", tag: "douyin" },
  { name: "TikTok", tag: "tiktok" },
  { name: "X / Twitter", tag: "twitter" },
  { name: "微博", tag: "weibo" },
  { name: "小红书", tag: "xiaohongshu" },
  { name: "Facebook", tag: "facebook" },
  { name: "Instagram", tag: "instagram" },
  { name: "Twitch", tag: "twitch" },
  { name: "Vimeo", tag: "vimeo" },
  { name: "腾讯视频", tag: "tencent" },
] as const;

export function PlatformSection() {
  return (
    <section id="platforms" className="bg-bg-main py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            支持主流视频平台
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
            基于 yt-dlp 生态，总计支持 1800+ 站点，覆盖国内外主流视频源。
          </p>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {PLATFORMS.map((p) => (
            <span
              key={p.tag}
              className="rounded-full border border-border bg-white px-4 py-2 text-sm text-text-secondary"
            >
              {p.name}
            </span>
          ))}
          <span className="px-2 text-sm text-text-muted">…等 1800+ 平台</span>
        </div>
      </div>
    </section>
  );
}