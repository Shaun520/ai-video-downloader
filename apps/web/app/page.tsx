import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { HomeWorkspace } from "@/components/home-workspace";
import { FeatureSection } from "@/components/feature-section";
import { HowToSection } from "@/components/how-to-section";
import { PricingSection } from "@/components/pricing-section";
import { PlatformSection } from "@/components/platform-section";
import { SiteFooter } from "@/components/site-footer";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader userEmail={user?.email ?? undefined} />
      <main className="flex-1">
        <HomeWorkspace />
        <FeatureSection />
        <HowToSection />
        <PricingSection />
        <PlatformSection />
      </main>
      <SiteFooter />
    </>
  );
}