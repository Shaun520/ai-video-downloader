import { AdminShell } from "@/components/admin-shell";
import { SettingsClient } from "@/components/settings-client";
import { getAdminDb } from "@/lib/db";
import { getAppSettings } from "@saveany/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getAppSettings(getAdminDb());
  return (
    <AdminShell>
      <SettingsClient initial={settings} />
    </AdminShell>
  );
}