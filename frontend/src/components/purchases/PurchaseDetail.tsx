"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, ErrorText, Field, Input, Modal, formatDateTime } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDate, useMoney } from "@/lib/money";
import type { Purchase } from "@/lib/types";
import { plural } from "@/lib/units";

import { PaymentBadge } from "./PaymentBadge";

export function PurchaseDetail({ purchase, onClose }: { purchase: Purchase | null; onClose: () => void }) {
  return (
    <Modal
      open={purchase !== null}
      title={purchase ? `${purchase.supplier.name}${purchase.invoice_no ? ` · ${purchase.invoice_no}` : ""}` : ""}
      onClose={onClose}
      size="lg"
    >
      {purchase && <Body key={purchase.id} purchase={purchase} onClose={onClose} />}
    </Modal>
  );
}

function Body({ purchase: p, onClose }: { purchase: Purchase; onClose: () => void }) {
  const qc = useQueryClient();
  const money = useMoney();
  const [paid, setPaid] = useState(String(p.amount_paid));
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.invalidateQueries({ queryKey: ["items"] });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not save");

  const pay = useMutation({
    mutationFn: (amount: number) => api<Purchase>(`/purchases/${p.id}/payment`, { method: "POST", json: { amount_paid: amount } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => api<Purchase>(`/purchases/${p.id}/cancel`, { method: "POST", json: { reason } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError,
  });

  const due = Math.round((p.total - p.amount_paid) * 100) / 100;
  const active = p.status === "received";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <PaymentBadge purchase={p} />
        <span className="text-ink-soft">Invoice date {formatDate(p.invoice_date)}</span>
        <span className="text-ink-soft">
          Entered {formatDateTime(p.created_at)}
          {p.creator && ` by ${p.creator.name}`}
        </span>
      </div>
      {p.status === "cancelled" && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Cancelled: {p.cancel_reason}. Its stock was taken back out.</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-ground text-left text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Cost each</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {p.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">
                  {l.item.name}
                  {l.expiry_date && <div className="text-xs text-ink-soft">Use by {formatDate(l.expiry_date)}</div>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular">
                  {l.qty} {plural(l.item.stock_unit, l.qty)}
                </td>
                <td className="px-3 py-2 text-right tabular">{money(l.unit_cost)}</td>
                <td className="px-3 py-2 text-right tabular">{money(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right font-semibold">
                Total
              </td>
              <td className="px-3 py-2 text-right font-bold tabular">{money(p.total)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-1 text-right text-ink-soft">
                Paid
              </td>
              <td className="px-3 py-1 text-right tabular">{money(p.amount_paid)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right text-ink-soft">
                Still to pay
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular">{money(active ? due : 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {p.notes && <p className="text-sm text-ink-soft">{p.notes}</p>}

      {active && !cancelling && (
        <div className="grid gap-3 rounded-xl bg-ground p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Total paid so far" hint="Enter the full amount paid to date, not just today's payment.">
            {(id) => <Input id={id} type="number" min={0} max={p.total} step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} className="tabular" />}
          </Field>
          <div className="flex gap-2">
            {due > 0 && (
              <Button variant="secondary" busy={pay.isPending} onClick={() => pay.mutate(p.total)}>
                Mark fully paid
              </Button>
            )}
            <Button busy={pay.isPending} onClick={() => pay.mutate(Number(paid) || 0)} disabled={Number(paid) === p.amount_paid}>
              Save payment
            </Button>
          </div>
        </div>
      )}

      {active && cancelling && (
        <div className="space-y-3 rounded-xl border border-danger/30 p-4">
          <p className="text-sm">Cancelling takes this purchase&apos;s stock back out. Use it only for a purchase entered by mistake.</p>
          <Field label="Why cancel?">
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" maxLength={300} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Keep purchase
            </Button>
            <Button variant="danger" busy={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>
              Cancel purchase
            </Button>
          </div>
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      {active && !cancelling && (
        <div className="flex justify-start">
          <Button variant="ghost" onClick={() => setCancelling(true)}>
            Cancel this purchase
          </Button>
        </div>
      )}
    </div>
  );
}
