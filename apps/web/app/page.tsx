import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { HomeWorkspace } from "@/components/home-workspace";
import { FeatureSection } from "@/components/feature-section";
import { HowToSection } from "@/components/how-to-section";
// import { PricingSection } from "@/components/pricing-section";
import { PlatformSection } from "@/components/platform-section";
import { SiteFooter } from "@/components/site-footer";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "zh-CN",
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      inLanguage: "zh-CN",
      description: SITE_DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
      featureList: [
        "多平台视频解析下载（YouTube / 哔哩哔哩 / 抖音 等 1800+ 站点）",
        "AI 视频内容总结",
        "思维导图生成",
        "字幕提取与导出",
        "基于视频内容的 AI 问答",
      ],
    },
  ],
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <SiteHeader userEmail={user?.email ?? undefined} />
      <main className="flex-1">
        <HomeWorkspace />
        <FeatureSection />
        <HowToSection />
        {/* <PricingSection /> */}
        <PlatformSection />
      </main>
      <SiteFooter />
    </>
  );
}