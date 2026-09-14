import { AdminShell } from "@/components/admin-shell";
import { UsersClient } from "@/components/users-client";

export default function UsersPage() {
  return (
    <AdminShell>
      <UsersClient />
    </AdminShell>
  );
}