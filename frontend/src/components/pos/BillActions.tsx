"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRightLeft, Ban, ChevronLeft, Combine, Percent, Receipt, Scissors, StickyNote, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, ErrorText, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { qtyText } from "@/lib/pos";
import type { Approval, DiningTable, Order } from "@/lib/types";

type Act = (call: (approval?: Approval, reason?: string) => Promise<Order>, title?: string, askReason?: boolean) => Promise<Order | undefined>;
export type View = "menu" | "move" | "merge" | "split" | "discount" | "note" | "void";

export function BillActions({
  order,
  open,
  onClose,
  act,
  error,
  initialView = "menu",
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  act: Act;
  error: string;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const close = () => {
    setView(initialView);
    onClose();
  };
  const titles: Record<View, string> = {
    menu: `${order.label} · #${order.id}`,
    move: "Move to another table",
    merge: "Merge another bill into this one",
    split: "Split bill",
    discount: "Discount",
    note: "Name and note",
    void: "Void bill",
  };
  return (
    <Modal open={open} title={titles[view]} onClose={close}>
      {view !== initialView && (
        <button onClick={() => setView("menu")} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden /> Back
        </button>
      )}
      {view === "menu" && <Menu order={order} act={act} go={setView} onClose={close} />}
      {view === "move" && <Move order={order} act={act} done={close} />}
      {view === "merge" && <Merge order={order} act={act} done={close} />}
      {view === "split" && <Split order={order} done={close} />}
      {view === "discount" && <Discount order={order} act={act} done={close} />}
      {view === "note" && <Note order={order} act={act} done={close} />}
      {view === "void" && <Void order={order} act={act} done={close} />}
      {view !== "menu" && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
    </Modal>
  );
}

const post = (id: number, path: string, json?: unknown) => api<Order>(`/orders/${id}${path}`, { method: "POST", json: json ?? {} });
const patch = (id: number, json: unknown) => api<Order>(`/orders/${id}`, { method: "PATCH", json });

function Menu({ order, act, go, onClose }: { order: Order; act: Act; go: (v: View) => void; onClose: () => void }) {
  const router = useRouter();
  const scOn = order.service_charge_percent > 0;
  const items: { icon: typeof Receipt; label: string; hint: string; onClick: () => void; hidden?: boolean; danger?: boolean }[] = [
    { icon: ArrowRightLeft, label: "Move to another table", hint: "The group changed seats.", onClick: () => go("move") },
    { icon: Combine, label: "Merge another bill into this one", hint: "Two tables or tabs pay together.", onClick: () => go("merge") },
    { icon: Scissors, label: "Split bill", hint: "Move some items to a separate bill.", onClick: () => go("split"), hidden: order.lines.length === 0 || order.paid > 0 },
    { icon: Percent, label: order.discount_type ? "Change discount" : "Discount", hint: "Needs a manager.", onClick: () => go("discount") },
    {
      icon: Receipt,
      label: scOn ? "Remove service charge" : "Add service charge",
      hint: scOn ? "Needs a manager." : "Uses the rate in Settings.",
      onClick: async () => {
        const o = await act((approval) => patch(order.id, { service_charge_on: !scOn, approval }), "Removing the service charge");
        if (o) onClose();
      },
    },
    { icon: StickyNote, label: "Name and note", hint: "Customer name, special requests.", onClick: () => go("note") },
    {
      icon: Trash2,
      label: "Delete empty bill",
      hint: "Opened by mistake.",
      hidden: order.lines.length > 0 || order.paid > 0,
      onClick: async () => {
        await api(`/orders/${order.id}`, { method: "DELETE" });
        router.push("/pos");
      },
    },
    { icon: Ban, label: "Void bill", hint: "Cancel the whole bill. Needs a manager.", onClick: () => go("void"), hidden: order.lines.length === 0, danger: true },
  ];
  return (
    <ul className="space-y-1">
      {items
        .filter((i) => !i.hidden)
        .map(({ icon: Icon, label, hint, onClick, danger }) => (
          <li key={label}>
            <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-ground">
              <Icon className={clsx("size-5 shrink-0", danger ? "text-danger" : "text-ink-soft")} aria-hidden />
              <span>
                <span className={clsx("block font-medium", danger && "text-danger")}>{label}</span>
                <span className="block text-sm text-ink-soft">{hint}</span>
              </span>
            </button>
          </li>
        ))}
    </ul>
  );
}

function Move({ order, act, done }: { order: Order; act: Act; done: () => void }) {
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<DiningTable[]>("/tables") });
  return (
    <ul className="grid grid-cols-3 gap-2">
      {tables.data
        ?.filter((t) => t.id !== order.table?.id)
        .map((t) => (
          <li key={t.id}>
            <button
              onClick={async () => {
                if (await act(() => patch(order.id, { table_id: t.id }))) done();
              }}
              className={clsx("h-16 w-full rounded-xl border-2 font-semibold", t.open_orders.length ? "border-amber-500 bg-amber-100" : "border-line hover:border-bottle-700")}
            >
              {t.name}
              {t.open_orders.length > 0 && <span className="block text-xs font-normal text-ink-soft">has a bill</span>}
            </button>
          </li>
        ))}
    </ul>
  );
}

function Merge({ order, act, done }: { order: Order; act: Act; done: () => void }) {
  const money = useMoney();
  const open = useQuery({ queryKey: ["orders", "open"], queryFn: () => api<Order[]>("/orders") });
  const others = open.data?.filter((o) => o.id !== order.id) ?? [];
  if (open.isSuccess && !others.length) return <p className="text-sm text-ink-soft">There are no other open bills.</p>;
  return (
    <ul className="space-y-2">
      {others.map((o) => (
        <li key={o.id}>
          <button
            onClick={async () => {
              if (await act(() => post(order.id, "/merge", { from_order_id: o.id }))) done();
            }}
            className="flex w-full items-center justify-between rounded-lg border border-line px-4 py-3 hover:bg-ground"
          >
            <span className="text-left">
              <span className="block font-medium">{o.label}</span>
              <span className="block text-sm text-ink-soft">
                #{o.id} · {qtyText(o.item_count)} items
              </span>
            </span>
            <span className="font-semibold tabular">{money(o.total)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Split({ order, done }: { order: Order; done: () => void }) {
  const router = useRouter();
  const money = useMoney();
  const [pick, setPick] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = Object.entries(pick).filter(([, q]) => q > 0);
  const subtotal = order.lines.reduce((s, l) => s + (pick[l.id] ?? 0) * l.unit_price, 0);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const o = await post(order.id, "/split", { lines: chosen.map(([id, qty]) => ({ line_id: Number(id), qty })) });
      done();
      router.push(`/pos/${o.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not split");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">Choose what moves to the new bill. Everything else stays here.</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {order.lines.map((l) => {
          const n = pick[l.id] ?? 0;
          return (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {l.name}
                <span className="block text-xs text-ink-soft tabular">
                  {qtyText(l.qty)} on bill · {money(l.unit_price)} each
                </span>
              </span>
              <Button variant="secondary" aria-label={`Move one less ${l.name}`} disabled={n <= 0} onClick={() => setPick({ ...pick, [l.id]: n - 1 })}>
                −
              </Button>
              <span className="w-6 text-center font-semibold tabular">{n}</span>
              <Button variant="secondary" aria-label={`Move one more ${l.name}`} disabled={n >= l.qty} onClick={() => setPick({ ...pick, [l.id]: Math.min(l.qty, n + 1) })}>
                +
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-sm">
        New bill: <span className="font-semibold tabular">{money(subtotal)}</span> before charges
      </p>
      <ErrorText>{error}</ErrorText>
      <Button className="w-full" size="lg" disabled={!chosen.length} busy={busy} onClick={submit}>
        Move to a new bill
      </Button>
    </div>
  );
}

function Discount({ order, act, done }: { order: Order; act: Act; done: () => void }) {
  const [type, setType] = useState<"percent" | "amount">(order.discount_type ?? "percent");
  const [value, setValue] = useState(order.discount_type ? String(order.discount_value) : "");
  const [reason, setReason] = useState(order.discount_reason);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const o = await act((approval) => post(order.id, "/discount", { type, value: Number(value), reason, approval }), "A discount");
        if (o) done();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Type">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as "percent" | "amount")}>
              <option value="percent">Percent off</option>
              <option value="amount">Amount off</option>
            </Select>
          )}
        </Field>
        <Field label={type === "percent" ? "Percent" : "Amount"}>
          {(id) => <Input id={id} type="number" min={0.01} max={type === "percent" ? 100 : undefined} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} required className="tabular" />}
        </Field>
      </div>
      <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Regular customer, staff meal" required minLength={2} maxLength={200} />}</Field>
      <div className="flex justify-between gap-2">
        {order.discount_type ? (
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              if (await act(() => api<Order>(`/orders/${order.id}/discount`, { method: "DELETE" }))) done();
            }}
          >
            Remove discount
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit">Apply discount</Button>
      </div>
    </form>
  );
}

function Note({ order, act, done }: { order: Order; act: Act; done: () => void }) {
  const [name, setName] = useState(order.customer_name);
  const [note, setNote] = useState(order.note);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act(() => patch(order.id, { customer_name: name, note }))) done();
      }}
      className="space-y-4"
    >
      <Field label="Customer name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required={order.type === "tab"} />}</Field>
      <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Birthday, allergic to nuts" />}</Field>
      <div className="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

function Void({ order, act, done }: { order: Order; act: Act; done: () => void }) {
  const money = useMoney();
  const [reason, setReason] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act((approval) => post(order.id, "/void", { reason, approval }), "Voiding a bill")) done();
      }}
      className="space-y-4"
    >
      <p className="text-sm">
        This cancels the whole bill of <span className="font-semibold tabular">{money(order.total)}</span>.
        {order.status === "paid" ? " Its stock goes back on the shelf and the payment counts as refunded." : ""} It stays in the records as voided.
      </p>
      <Field label="Why?">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer left, wrong table" required minLength={3} maxLength={300} />}</Field>
      <Button type="submit" variant="danger" className="w-full" size="lg">
        Void bill
      </Button>
    </form>
  );
}
