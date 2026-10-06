import { Badge } from "@/components/ui";
import type { Purchase } from "@/lib/types";

export function PaymentBadge({ purchase: p }: { purchase: Purchase }) {
  if (p.status === "cancelled") return <Badge tone="off">Cancelled</Badge>;
  if (p.amount_paid >= p.total) return <Badge tone="ok">Paid</Badge>;
  if (p.amount_paid > 0) return <Badge tone="warn">Part paid</Badge>;
  return <Badge tone="warn">Unpaid</Badge>;
}
