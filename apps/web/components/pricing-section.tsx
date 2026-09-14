import Link from "next/link";
import { CheckIcon } from "./icons";
import { CheckoutButton } from "./checkout-button";

interface Plan {
  name: string;
  price: string;
  period: string;
  highlight: boolean;
  features: string[];
  cta: string;
  href?: string;
  planType?: "monthly" | "yearly";
}

const PLANS: Plan[] = [
  {
    name: "免费版",
    price: "¥0",
    period: "永久",
    highlight: false,
    features: [
      "视频解析与下载（全平台）",
      "最高 720p 直链下载",
      "每日 3 次 AI 总结",
      "思维导图 / 字幕 / 问答",
      "无广告，无需绑定信用卡",
    ],
    cta: "开始使用",
    href: "/register",
  },
  {
    name: "VIP 会员",
    price: "¥9.9",
    period: "/ 月，双月付减",
    highlight: true,
    planType: "monthly" as const,
    features: [
      "包含免费版全部功能",
      "AI 总结不限次数",
      "原画质 / 4K 直链优先",
      "优先解析队列与稳定性",
      "字幕批量导出（SRT/VTT/TXT）",
      "长期有效，随时取消",
    ],
    cta: "立即开通",
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            简单透明的定价
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
            下载功能永久免费；AI 总结等高级能力升级 VIP 即可无限使用。
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={
                p.highlight
                  ? "relative rounded-2xl border-2 border-primary bg-white p-7 shadow-md"
                  : "rounded-2xl border border-border bg-white p-7"
              }
            >
              {p.highlight && (
                <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-xs font-medium text-white">
                  最受欢迎
                </span>
              )}
              <h3 className="text-lg font-semibold text-text-primary">{p.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight text-text-primary">{p.price}</span>
                {p.period !== "永久" && (
                  <span className="text-sm text-text-muted">{p.period}</span>
                )}
                {p.period === "永久" && (
                  <span className="text-sm text-text-muted">永久</span>
                )}
              </div>
              <ul className="mt-6 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              {p.planType ? (
                <div className="mt-8">
                  <CheckoutButton planType={p.planType} />
                </div>
              ) : p.href ? (
                <Link
                  href={p.href}
                  className={
                    p.highlight
                      ? "mt-8 flex h-11 w-full items-center justify-center rounded-full bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                      : "mt-8 flex h-11 w-full items-center justify-center rounded-full border border-border text-sm font-medium text-text-primary transition-colors hover:border-primary hover:text-primary"
                  }
                >
                  {p.cta}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}