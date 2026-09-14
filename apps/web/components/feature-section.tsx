import { BoltIcon, CameraIcon, ShieldIcon, SparklesIcon } from "./icons";

const FEATURES = [
  {
    icon: SparklesIcon,
    title: "AI 深度总结",
    desc: "一键生成视频内容大纲、核心要点与全文总结，无需完整观看，几分钟了解全部重点。",
  },
  {
    icon: BoltIcon,
    title: "直链极速下载",
    desc: "优先返回源站高清直链，浏览器直接保存，不经过中转服务器，又快又稳。",
  },
  {
    icon: CameraIcon,
    title: "多平台一站通",
    desc: "支持 YouTube、哔哩哔哩、抖音、TikTok、X 等主流平台，自动识别并给出最佳清晰度。",
  },
  {
    icon: ShieldIcon,
    title: "隐私与安全",
    desc: "链接仅用于解析与下载，不保存你的历史与数据，无广告弹窗、无需安装任何软件。",
  },
] as const;

export function FeatureSection() {
  return (
    <section id="features" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            把「下载视频」和「看懂视频」放在一起
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
            不只是解析链接——这里还内置了 AI 总结、思维导图与基于视频内容的问答。
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-white p-6 transition-shadow hover:shadow-md"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-[15px] font-semibold text-text-primary">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}