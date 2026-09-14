import { AdminShell } from "@/components/admin-shell";
import { OrdersClient } from "@/components/orders-client";

export default function OrdersPage() {
  return (
    <AdminShell>
      <OrdersClient />
    </AdminShell>
  );
}