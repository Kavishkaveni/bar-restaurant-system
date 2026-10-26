"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Ban, Printer, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import { BillActions } from "@/components/pos/BillActions";
import { BillPanel } from "@/components/pos/BillPanel";
import { ItemPicker } from "@/components/pos/ItemPicker";
import { PayDialog } from "@/components/pos/PayDialog";
import { useBottlePrompt } from "@/components/pos/OpenBottlePrompt";
import { useOrder } from "@/components/pos/useOrder";
import { Badge, Button, ErrorText, Modal, Panel, Spinner, formatDateTime } from "@/components/ui";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { METHOD_LABEL, minutesSince, qtyText } from "@/lib/pos";
import type { Approval, Menu, MenuItem, MenuOption, Order, OrderLine } from "@/lib/types";

export default function OrderPage() {
  return (
    <Guard anyOf={["pos.order", "pos.payment", "dashboard.view"]}>
      <OrderScreen />
    </Guard>
  );
}

function OrderScreen() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const { query, order, act, put, busy, error, setError } = useOrder(id);
  const { withBottle, prompt } = useBottlePrompt();
  const menu = useQuery({ queryKey: ["pos-menu"], queryFn: () => api<Menu>("/pos/menu"), staleTime: 60_000 });
  const money = useMoney();

  const [paying, setPaying] = useState(false);
  const [more, setMore] = useState(false);
  const [billOpen, setBillOpen] = useState(false);

  if (query.isLoading) return <Spinner />;
  if (query.error || !order) return <ErrorText>{(query.error as Error)?.message ?? "Bill not found"}</ErrorText>;
  if (order.status !== "open" && !paying) return <ClosedBill order={order} act={act} error={error} />;

  const add = (item: MenuItem, option: MenuOption) =>
    act(() =>
      withBottle((open_bottle) =>
        api<Order>(`/orders/${id}/lines`, { method: "POST", json: { item_id: item.id, option_id: option.id, qty: 1, open_bottle } }),
      ),
    );
  const patchLine = (line: OrderLine, qty: number, approval?: Approval, reason?: string) =>
    withBottle((open_bottle) =>
      api<Order>(`/orders/${id}/lines/${line.id}`, { method: "PATCH", json: { qty, approval, reason: reason ?? "", open_bottle } }),
    );
  const removeLine = (line: OrderLine, approval?: Approval, reason?: string) =>
    api<Order>(`/orders/${id}/lines/${line.id}/remove`, { method: "POST", json: { approval, reason: reason ?? "" } });

  const panel = (
    <BillPanel
      order={order}
      act={act}
      patchLine={patchLine}
      removeLine={removeLine}
      busy={busy}
      onPay={() => {
        setBillOpen(false);
        setPaying(true);
      }}
      onPrint={() => router.push(`/print/${order.id}`)}
      onMore={() => {
        setError("");
        setMore(true);
      }}
    />
  );

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-10 lg:-my-8">
      <div className="lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="px-4 py-4 pb-28 sm:px-6 lg:overflow-y-auto lg:pb-6">
          <header className="mb-4 flex items-center gap-3">
            <Link href="/pos" className="grid size-10 place-items-center rounded-lg border border-line bg-surface hover:bg-ground" aria-label="Back to tables">
              <ArrowLeft className="size-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">{order.label}</h1>
              <p className="text-sm text-ink-soft">
                Bill #{order.id} · {minutesSince(order.created_at)} · {order.opener?.name}
                {order.note && ` · ${order.note}`}
              </p>
            </div>
          </header>
          {error && !more && (
            <div className="mb-3">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          {menu.isLoading ? <Spinner /> : menu.data && <ItemPicker menu={menu.data} onPick={add} busy={busy} />}
        </section>

        <aside className="hidden border-l border-line bg-surface lg:block">{panel}</aside>
      </div>

      {/* Phone and tablet: the bill lives behind a bottom bar. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-3 lg:hidden">
        <button onClick={() => setBillOpen(true)} className="flex w-full items-center justify-between rounded-xl bg-bottle-900 px-4 py-3 text-white">
          <span className="text-sm">
            View bill · <span className="tabular">{qtyText(order.item_count)}</span> items
          </span>
          <span className="text-lg font-bold tabular">{money(order.total)}</span>
        </button>
      </div>
      <Modal open={billOpen} title={order.label} onClose={() => setBillOpen(false)} size="lg">
        <div className="-m-5 h-[75dvh]">{panel}</div>
      </Modal>

      <PayDialog
        order={order}
        open={paying}
        onClose={() => setPaying(false)}
        onPaid={put}
        onPrintReceipt={() => router.push(`/print/${order.id}`)}
        onDone={() => router.push("/pos")}
      />
      <BillActions order={order} open={more} onClose={() => setMore(false)} act={act} error={error} />
      {prompt}
    </div>
  );
}

function ClosedBill({ order, act, error }: { order: Order; act: ReturnType<typeof useOrder>["act"]; error: string }) {
  const money = useMoney();
  const router = useRouter();
  const [voiding, setVoiding] = useState(false);

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="grid size-10 place-items-center rounded-lg border border-line bg-surface hover:bg-ground" aria-label="Back">
          <ArrowLeft className="size-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold">{order.label}</h1>
          <p className="text-sm text-ink-soft">Bill #{order.id}</p>
        </div>
        <span className="ml-auto">
          {order.status === "paid" && <Badge tone="ok">Paid</Badge>}
          {order.status === "void" && <Badge tone="off">Void</Badge>}
          {order.status === "merged" && <Badge tone="off">Merged</Badge>}
        </span>
      </header>

      {order.status === "void" && <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Voided: {order.void_reason}</p>}
      {order.status === "merged" && (
        <p className="mb-4 text-sm">
          Moved into{" "}
          <Link className="font-semibold underline" href={`/pos/${order.merged_into}`}>
            bill #{order.merged_into}
          </Link>
          .
        </p>
      )}

      <Panel>
        <ul className="divide-y divide-line">
          {order.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span>
                <span className="tabular">{qtyText(l.qty)} ×</span> {l.name}
              </span>
              <span className="tabular">{money(l.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-line px-4 py-3 text-sm">
          <Line label="Subtotal" value={money(order.subtotal)} />
          {order.discount > 0 && <Line label={`Discount · ${order.discount_reason}`} value={`− ${money(order.discount)}`} />}
          {order.service_charge > 0 && <Line label="Service charge" value={money(order.service_charge)} />}
          {order.tax > 0 && <Line label="Tax" value={money(order.tax)} />}
          <Line label="Total" value={money(order.total)} strong />
          {order.payments.map((p) => (
            <Line
              key={p.id}
              label={`${METHOD_LABEL[p.method]}${p.reference ? ` (${p.reference})` : ""} · ${p.user?.name ?? ""}`}
              value={money(p.amount) + (p.tip > 0 ? ` + tip ${money(p.tip)}` : "")}
            />
          ))}
        </dl>
        <p className="border-t border-line px-4 py-3 text-xs text-ink-soft">
          Opened {formatDateTime(order.created_at)} by {order.opener?.name}
          {order.closed_at && ` · closed ${formatDateTime(order.closed_at)}`}
          {order.closer && ` by ${order.closer.name}`}
        </p>
      </Panel>

      {order.status === "paid" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="lg" onClick={() => router.push(`/print/${order.id}`)}>
            <Printer className="size-5" aria-hidden /> Print receipt
          </Button>
          <Button size="lg" variant="ghost" onClick={() => setVoiding(true)}>
            <Ban className="size-5" aria-hidden /> Void bill
          </Button>
        </div>
      )}
      {order.status !== "paid" && (
        <Link href="/pos" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline">
          <ReceiptText className="size-4" aria-hidden /> Back to POS
        </Link>
      )}
      <BillActions order={order} open={voiding} onClose={() => setVoiding(false)} act={act} error={error} initialView="void" />
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={clsx("flex justify-between gap-3", strong && "pt-1 text-base font-bold")}>
      <dt className={strong ? "" : "text-ink-soft"}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}