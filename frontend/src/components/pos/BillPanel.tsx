"use client";

import clsx from "clsx";
import { Minus, MoreHorizontal, Plus, Printer, Trash2 } from "lucide-react";

import { Button } from "@/components/ui";
import { useMoney } from "@/lib/money";
import { qtyText } from "@/lib/pos";
import type { Approval, KitchenStatus, Order, OrderLine } from "@/lib/types";

const KITCHEN_CHIP: Record<KitchenStatus, { label: string; cls: string }> = {
  new: { label: "Sent to kitchen", cls: "bg-amber-100 text-amber-600" },
  preparing: { label: "Cooking", cls: "bg-bottle-100 text-bottle-800" },
  ready: { label: "Ready to serve", cls: "bg-ok-soft text-ok" },
  served: { label: "Served", cls: "bg-ground text-ink-soft" },
};

type Act = (
  call: (approval?: Approval, reason?: string) => Promise<Order>,
  title?: string,
  askReason?: boolean,
) => Promise<Order | undefined>;

export function BillPanel({
  order,
  act,
  patchLine,
  removeLine,
  busy,
  onPay,
  onPrint,
  onMore,
}: {
  order: Order;
  act: Act;
  patchLine: (
    line: OrderLine,
    qty: number,
    approval?: Approval,
    reason?: string,
  ) => Promise<Order>;
  removeLine: (
    line: OrderLine,
    approval?: Approval,
    reason?: string,
  ) => Promise<Order>;
  busy: boolean;
  onPay: () => void;
  onPrint: () => void;
  onMore: () => void;
}) {
  const money = useMoney();
  const locked = order.printed_count > 0 || order.paid > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {order.lines.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-soft">
            Tap items to add them to the bill.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {order.lines.map((line) => (
              <li key={line.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium">
                    {line.name}
                    {line.note && (
                      <span className="block text-xs font-normal text-ink-soft">
                        {line.note}
                      </span>
                    )}
                    {line.kitchen_status && line.kitchen_status !== "new" && (
                      <span
                        className={clsx(
                          "mt-1 block w-fit rounded-full px-2 py-0.5 text-xs font-medium",
                          KITCHEN_CHIP[line.kitchen_status].cls,
                        )}
                      >
                        {KITCHEN_CHIP[line.kitchen_status].label}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-semibold tabular">
                    {money(line.line_total)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    aria-label={`One less ${line.name}`}
                    disabled={busy}
                    onClick={() =>
                      line.qty > 1
                        ? act(
                            (a, r) => patchLine(line, line.qty - 1, a, r),
                            `Taking ${line.name} off`,
                            true,
                          )
                        : act(
                            (a, r) => removeLine(line, a, r),
                            `Removing ${line.name}`,
                            true,
                          )
                    }
                    className="grid size-9 place-items-center rounded-lg border border-line hover:bg-ground disabled:opacity-50"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <span className="w-8 text-center font-semibold tabular">
                    {qtyText(line.qty)}
                  </span>
                  <button
                    aria-label={`One more ${line.name}`}
                    disabled={busy}
                    onClick={() => act(() => patchLine(line, line.qty + 1))}
                    className="grid size-9 place-items-center rounded-lg border border-line hover:bg-ground disabled:opacity-50"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                  <span className="ml-1 text-xs text-ink-soft tabular">
                    × {money(line.unit_price)}
                  </span>
                  <button
                    aria-label={`Remove ${line.name}`}
                    disabled={busy}
                    onClick={() =>
                      act(
                        (a, r) => removeLine(line, a, r),
                        `Removing ${line.name}`,
                        true,
                      )
                    }
                    className="ml-auto grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <dl className="space-y-1 text-sm">
          <Row label="Subtotal" value={money(order.subtotal)} />
          {order.discount > 0 && (
            <Row
              label={`Discount${order.discount_type === "percent" ? ` ${order.discount_value}%` : ""}${order.discount_reason ? ` · ${order.discount_reason}` : ""}`}
              value={`− ${money(order.discount)}`}
            />
          )}
          {order.service_charge > 0 && (
            <Row
              label={`Service charge ${order.service_charge_percent}%`}
              value={money(order.service_charge)}
            />
          )}
          {order.tax > 0 && (
            <Row label={`Tax ${order.tax_percent}%`} value={money(order.tax)} />
          )}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-semibold">Total</dt>
            <dd className="text-2xl font-bold tabular">{money(order.total)}</dd>
          </div>
          {order.paid > 0 && (
            <>
              <Row label="Paid" value={money(order.paid)} />
              <Row label="Still to pay" value={money(order.due)} strong />
            </>
          )}
        </dl>
        {locked && (
          <p className="mt-2 text-xs text-ink-soft">
            Bill printed: removing items now needs a manager.
          </p>
        )}
        <div className="mt-3 grid grid-cols-[auto_auto_1fr] gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={onMore}
            aria-label="More actions"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={onPrint}
            disabled={!order.lines.length}
          >
            <Printer className="size-5" aria-hidden /> Bill
          </Button>
          <Button
            size="lg"
            onClick={onPay}
            disabled={!order.lines.length || busy}
          >
            Pay {money(order.due)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={clsx("tabular", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
