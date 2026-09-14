const STEPS = [
  {
    no: "01",
    title: "复制视频链接",
    desc: "在任意平台分享/复制想保存的视频链接，粘贴到上方输入框。",
  },
  {
    no: "02",
    title: "一键解析",
    desc: "点击解析，自动识别平台并抓取可用清晰度与字幕信息，全程秒级完成。",
  },
  {
    no: "03",
    title: "下载或让 AI 总结",
    desc: "选择清晰度直接下载；免费注册后还可生成 AI 总结、思维导图并针对内容提问。",
  },
] as const;

export function HowToSection() {
  return (
    <section id="how" className="bg-bg-main py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            三步搞定，无需注册
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
            下载功能开箱即用；注册后可解锁 AI 总结等高级能力。
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.no} className="relative rounded-2xl border border-border bg-white p-6">
              <span className="text-sm font-semibold text-primary">{s.no}</span>
              <h3 className="mt-3 text-[15px] font-semibold text-text-primary">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}