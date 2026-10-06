"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Button, ErrorText, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { todayISO, useMoney } from "@/lib/money";
import type { Item, Purchase, Supplier } from "@/lib/types";
import { plural } from "@/lib/units";

type Line = { key: number; itemId: number | ""; qty: string; cost: string; expiry: string };

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: "", qty: "", cost: "", expiry: "" });

export function PurchaseForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="New purchase" onClose={onClose} size="lg">
      {open && <Body onClose={onClose} />}
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const money = useMoney();
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/suppliers") });
  const items = useQuery({ queryKey: ["items", "list"], queryFn: () => api<Item[]>("/items") });

  const [supplierId, setSupplierId] = useState<number | "">("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
  const lineTotal = (l: Line) => Math.round((Number(l.qty) || 0) * (Number(l.cost) || 0) * 100) / 100;
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () =>
      api<Purchase>("/purchases", {
        method: "POST",
        json: {
          supplier_id: supplierId,
          invoice_no: invoiceNo,
          invoice_date: invoiceDate,
          notes,
          amount_paid: Number(paid) || 0,
          lines: lines
            .filter((l) => l.itemId !== "")
            .map((l) => ({ item_id: l.itemId, qty: Number(l.qty), unit_cost: Number(l.cost) || 0, expiry_date: l.expiry || null })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!supplierId) return setError("Choose a supplier.");
    const filled = lines.filter((l) => l.itemId !== "");
    if (!filled.length) return setError("Add at least one item.");
    if (filled.some((l) => !(Number(l.qty) > 0))) return setError("Every item needs a quantity above 0.");
    if ((Number(paid) || 0) > total) return setError("Amount paid can't be more than the total.");
    save.mutate();
  }

  if (suppliers.data && suppliers.data.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p>Add a supplier first. Every purchase is recorded against the supplier you bought from.</p>
        <p className="text-ink-soft">Open the Suppliers tab, add one, then come back here.</p>
        <Button onClick={onClose}>OK</Button>
      </div>
    );
  }
  if (items.data && items.data.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p>Add your items first in Inventory, then record what you bought here.</p>
        <Button onClick={onClose}>OK</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Supplier">
          {(id) => (
            <Select id={id} value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))} required>
              <option value="" disabled>
                Choose a supplier
              </option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Invoice number">{(id) => <Input id={id} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={60} />}</Field>
        <Field label="Invoice date">{(id) => <Input id={id} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />}</Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Items received</legend>
        <ul className="space-y-3">
          {lines.map((l, idx) => {
            const it = l.itemId === "" ? undefined : itemById.get(l.itemId);
            const unit = it?.stock_unit ?? "unit";
            return (
              <li key={l.key} className="rounded-xl border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <Field label={`Item ${idx + 1}`}>
                    {(id) => (
                      <Select
                        id={id}
                        value={l.itemId}
                        onChange={(e) => {
                          const picked = itemById.get(Number(e.target.value));
                          update(l.key, { itemId: Number(e.target.value), cost: l.cost || (picked?.cost_price ? String(picked.cost_price) : "") });
                        }}
                      >
                        <option value="" disabled>
                          Choose an item
                        </option>
                        {items.data?.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={`Quantity (${plural(unit, 2)})`}>
                    {(id) => (
                      <Input id={id} type="number" min={0} step="any" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="tabular" />
                    )}
                  </Field>
                  <Field label={`Cost per ${unit}`}>
                    {(id) => (
                      <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} className="tabular" />
                    )}
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove item ${idx + 1}`}
                    className="justify-self-end"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  {it?.category.module === "food" ? (
                    <label className="flex items-center gap-2 whitespace-nowrap text-ink-soft">
                      Use by
                      <Input type="date" value={l.expiry} onChange={(e) => update(l.key, { expiry: e.target.value })} className="h-8 w-auto" />
                    </label>
                  ) : (
                    <span />
                  )}
                  <span className="text-ink-soft">
                    Line total <span className="font-semibold text-ink tabular">{money(lineTotal(l))}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="secondary" className="mt-3" onClick={() => setLines((ls) => [...ls, blankLine()])}>
          <Plus className="size-4" aria-hidden /> Add another item
        </Button>
      </fieldset>

      <div className="grid gap-4 rounded-xl bg-ground p-4 sm:grid-cols-2 sm:items-end">
        <div>
          <div className="text-sm text-ink-soft">Invoice total</div>
          <div className="text-2xl font-bold tabular">{money(total)}</div>
        </div>
        <Field label="Amount paid now" hint="Leave 0 if you'll pay later. You can record payments afterwards.">
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} type="number" min={0} step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} className="tabular" />
              <Button type="button" variant="secondary" onClick={() => setPaid(String(total))}>
                Paid in full
              </Button>
            </div>
          )}
        </Field>
      </div>

      <Field label="Notes (optional)">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>

      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" busy={save.isPending}>
          Save purchase
        </Button>
      </div>
    </form>
  );
}
