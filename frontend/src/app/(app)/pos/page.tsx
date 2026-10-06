"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  BedDouble,
  ChevronLeft,
  ChevronRight,
  Settings2,
  ShoppingBag,
  UserRound,
  Wallet,
  Wine,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import { useCurrentShift } from "@/components/money/CashDrawer";
import { TablesManager } from "@/components/pos/TablesManager";
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  Tabs,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayISO, useMoney } from "@/lib/money";
import { METHOD_LABEL, minutesSince, timeOf } from "@/lib/pos";
import type {
  BillsPage,
  BookingBrief,
  DiningTable,
  Order,
  OrderType,
} from "@/lib/types";

type Tab = "tables" | "open" | "bills";

export default function PosPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("tables");
  const tabs: { key: Tab; label: string }[] = [
    { key: "tables", label: "Tables" },
    { key: "open", label: "Open bills" },
  ];
  if (can("pos.payment") || can("dashboard.view"))
    tabs.push({ key: "bills", label: "Today's bills" });

  return (
    <Guard anyOf={["pos.order", "pos.payment", "pos.room_service"]}>
      <PageHeader title="POS" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "tables" && <Floor />}
      {tab === "open" && <OpenBills />}
      {tab === "bills" && <Bills />}
    </Guard>
  );
}

function useNewOrder() {
  const router = useRouter();
  return useMutation({
    mutationFn: (body: {
      type: OrderType;
      table_id?: number;
      customer_name?: string;
      booking_id?: number;
    }) => api<Order>("/orders", { method: "POST", json: body }),
    onSuccess: (o) => router.push(`/pos/${o.id}`),
  });
}

function Floor() {
  const { can } = useAuth();
  const money = useMoney();
  const router = useRouter();
  const tables = useQuery({
    queryKey: ["tables"],
    queryFn: () => api<DiningTable[]>("/tables"),
    refetchInterval: 15_000,
  });
  const create = useNewOrder();
  const [managing, setManaging] = useState(false);
  const [picker, setPicker] = useState<DiningTable | null>(null);
  const [named, setNamed] = useState<"tab" | "takeaway" | null>(null);
  const [roomPicker, setRoomPicker] = useState(false);
  const takesOrders = can("pos.order");

  if (tables.isLoading) return <Spinner />;
  const list = tables.data ?? [];
  const areas = [...new Set(list.map((t) => t.area || "Tables"))];

  function openTable(t: DiningTable) {
    if (!takesOrders) return;
    if (t.open_orders.length === 0)
      return create.mutate({ type: "table", table_id: t.id });
    if (t.open_orders.length === 1)
      return router.push(`/pos/${t.open_orders[0].id}`);
    setPicker(t);
  }

  return (
    <>
      {can("pos.payment") && <DrawerBanner />}
      <div className="mb-5 flex flex-wrap gap-2">
        {takesOrders && (
          <>
            <Button
              size="lg"
              busy={create.isPending && create.variables?.type === "bar"}
              onClick={() => create.mutate({ type: "bar" })}
            >
              <Wine className="size-5" aria-hidden /> Bar sale
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setNamed("tab")}
            >
              <UserRound className="size-5" aria-hidden /> New tab
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setNamed("takeaway")}
            >
              <ShoppingBag className="size-5" aria-hidden /> Takeaway
            </Button>
          </>
        )}
        {(takesOrders || can("pos.room_service")) && (
          <Button
            size="lg"
            variant={takesOrders ? "secondary" : "primary"}
            onClick={() => setRoomPicker(true)}
          >
            <BedDouble className="size-5" aria-hidden /> Room service
          </Button>
        )}
        {can("catalogue.manage") && (
          <Button
            size="lg"
            variant="ghost"
            className="sm:ml-auto"
            onClick={() => setManaging(true)}
          >
            <Settings2 className="size-5" aria-hidden /> Set up tables
          </Button>
        )}
      </div>
      {create.error && <ErrorText>{(create.error as Error).message}</ErrorText>}

      {list.length === 0 ? (
        <Panel className="px-6 py-12 text-center">
          <p className="font-semibold">No tables yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            {can("catalogue.manage")
              ? "Use Set up tables to add them. Bar sales and tabs work without tables."
              : "Ask a manager to add the tables."}
          </p>
        </Panel>
      ) : (
        areas.map((area) => (
          <section key={area} className="mb-6">
            {areas.length > 1 && (
              <h2 className="mb-2 text-sm font-semibold text-ink-soft">
                {area}
              </h2>
            )}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list
                .filter((t) => (t.area || "Tables") === area)
                .map((t) => {
                  const busy = t.open_orders.length > 0;
                  const total = t.open_orders.reduce((s, o) => s + o.total, 0);
                  const oldest = t.open_orders[0]?.opened_at;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => openTable(t)}
                        disabled={create.isPending}
                        className={clsx(
                          "flex h-28 w-full flex-col justify-between rounded-xl border-2 p-3 text-left transition-colors",
                          busy
                            ? "border-amber-500 bg-amber-100 hover:bg-amber-100/70"
                            : "border-line bg-surface hover:border-bottle-700",
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-lg font-bold">{t.name}</span>
                          {t.open_orders.some((o) => o.printed) && (
                            <Badge tone="warn">Bill printed</Badge>
                          )}
                        </span>
                        {busy ? (
                          <span>
                            <span className="block font-semibold tabular">
                              {money(total)}
                            </span>
                            <span className="block text-xs text-ink-soft">
                              {minutesSince(oldest!)}
                              {t.open_orders.length > 1 &&
                                ` · ${t.open_orders.length} bills`}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-ink-soft">
                            Free · {t.seats} seats
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))
      )}

      <TablesManager
        open={managing}
        tables={list}
        onClose={() => setManaging(false)}
      />

      <Modal
        open={picker !== null}
        title={`Bills on ${picker?.name}`}
        onClose={() => setPicker(null)}
      >
        <div className="space-y-2">
          {picker?.open_orders.map((o) => (
            <button
              key={o.id}
              onClick={() => router.push(`/pos/${o.id}`)}
              className="flex w-full items-center justify-between rounded-lg border border-line px-4 py-3 hover:bg-ground"
            >
              <span className="font-medium">Bill #{o.id}</span>
              <span className="tabular">{money(o.total)}</span>
            </button>
          ))}
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              picker && create.mutate({ type: "table", table_id: picker.id })
            }
          >
            Start another bill on this table
          </Button>
        </div>
      </Modal>

      <NamedOrder kind={named} onClose={() => setNamed(null)} />
      <RoomServicePicker
        open={roomPicker}
        onClose={() => setRoomPicker(false)}
      />
    </>
  );
}

/** Reminds the cashier to open the drawer before taking cash. */
function DrawerBanner() {
  const money = useMoney();
  const shift = useCurrentShift();
  if (shift.isLoading) return null;
  const s = shift.data;
  return (
    <Link
      href="/expenses"
      className={clsx(
        "mb-4 flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm hover:brightness-95",
        s ? "border-line bg-surface" : "border-amber-500 bg-amber-100",
      )}
    >
      <Wallet
        className={clsx(
          "size-5 shrink-0",
          s ? "text-ink-soft" : "text-amber-600",
        )}
        aria-hidden
      />
      {s ? (
        <span className="flex-1">
          Cash drawer open since {timeOf(s.opened_at)} ({s.opener?.name}) ·{" "}
          <span className="font-semibold tabular">
            {money(s.drawer.expected)}
          </span>{" "}
          in the drawer
        </span>
      ) : (
        <span className="flex-1 font-medium">
          The cash drawer isn&apos;t open. Tap here to open it before taking
          cash.
        </span>
      )}
    </Link>
  );
}

/** Pick a staying guest to start a room service order for. */
function RoomServicePicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useNewOrder();
  const guests = useQuery({
    queryKey: ["in-house"],
    queryFn: () => api<BookingBrief[]>("/bookings/in-house"),
    enabled: open,
  });
  return (
    <Modal open={open} title="Room service" onClose={onClose}>
      {guests.isLoading ? (
        <Spinner />
      ) : !guests.data?.length ? (
        <p className="text-sm text-ink-soft">
          No guests are checked in right now.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {guests.data.map((g) => (
            <li key={g.id}>
              <button
                onClick={() =>
                  create.mutate({ type: "room", booking_id: g.id })
                }
                disabled={create.isPending}
                className="flex w-full items-center gap-3 rounded-xl border-2 border-line p-3 text-left hover:border-bottle-700"
              >
                <span className="text-xl font-bold">{g.room.number}</span>
                <span className="min-w-0 truncate text-sm">{g.guest_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorText>
        {create.error instanceof ApiError ? create.error.message : ""}
      </ErrorText>
    </Modal>
  );
}

function NamedOrder({
  kind,
  onClose,
}: {
  kind: "tab" | "takeaway" | null;
  onClose: () => void;
}) {
  const create = useNewOrder();
  const [name, setName] = useState("");
  return (
    <Modal
      open={kind !== null}
      title={kind === "tab" ? "New tab" : "Takeaway"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (kind) create.mutate({ type: kind, customer_name: name });
        }}
        className="space-y-4"
      >
        <Field
          label={kind === "tab" ? "Customer name" : "Customer name (optional)"}
          hint={
            kind === "tab"
              ? "A tab stays open across rounds until the customer pays."
              : undefined
          }
        >
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required={kind === "tab"}
              maxLength={80}
              autoFocus
            />
          )}
        </Field>
        <ErrorText>
          {create.error instanceof ApiError ? create.error.message : ""}
        </ErrorText>
        <div className="flex justify-end">
          <Button type="submit" busy={create.isPending}>
            {kind === "tab" ? "Open tab" : "Start order"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OpenBills() {
  const money = useMoney();
  const router = useRouter();
  const orders = useQuery({
    queryKey: ["orders", "open"],
    queryFn: () => api<Order[]>("/orders"),
    refetchInterval: 15_000,
  });
  if (orders.isLoading) return <Spinner />;
  const list = orders.data ?? [];
  if (!list.length)
    return (
      <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
        No open bills right now.
      </Panel>
    );
  return (
    <Panel>
      <ul className="divide-y divide-line">
        {list.map((o) => (
          <li key={o.id}>
            <button
              onClick={() => router.push(`/pos/${o.id}`)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-ground"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-sm text-ink-soft">
                  #{o.id} · {minutesSince(o.created_at)} · {o.opener?.name}
                </span>
              </span>
              {o.printed_count > 0 && <Badge tone="warn">Printed</Badge>}
              {o.paid > 0 && <Badge tone="ok">Part paid</Badge>}
              <span className="font-semibold tabular">{money(o.total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Bills() {
  const money = useMoney();
  const router = useRouter();
  const [day, setDay] = useState(todayISO());
  const [page, setPage] = useState(1);
  const bills = useQuery({
    queryKey: ["orders", "bills", day, page],
    queryFn: () =>
      api<BillsPage>(`/orders/bills?day=${day}&page=${page}&page_size=25`),
    placeholderData: keepPreviousData,
  });
  const d = bills.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.page_size)) : 1;

  return (
    <>
      <div className="mb-4 max-w-48">
        <Field label="Day">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={day}
              max={todayISO()}
              onChange={(e) => {
                setDay(e.target.value || todayISO());
                setPage(1);
              }}
            />
          )}
        </Field>
      </div>
      {bills.isLoading || !d ? (
        <Spinner />
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Sales" value={money(d.sales_total)} strong />
            <Stat label="Paid bills" value={String(d.bill_count)} />
            {d.by_method.map((m) => (
              <Stat
                key={m.method}
                label={METHOD_LABEL[m.method]}
                value={money(m.amount)}
              />
            ))}
            {d.tips_total > 0 && (
              <Stat label="Tips" value={money(d.tips_total)} />
            )}
            {d.void_count > 0 && (
              <Stat label="Voided bills" value={String(d.void_count)} warn />
            )}
          </dl>
          {d.items.length === 0 ? (
            <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
              No closed bills on this day.
            </Panel>
          ) : (
            <Panel>
              <ul className="divide-y divide-line">
                {d.items.map((o) => (
                  <li key={o.id}>
                    <button
                      onClick={() => router.push(`/pos/${o.id}`)}
                      className={clsx(
                        "flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-ground",
                        o.status === "void" && "opacity-60",
                      )}
                    >
                      <span className="w-14 shrink-0 text-sm text-ink-soft tabular">
                        {o.closed_at && timeOf(o.closed_at)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{o.label}</span>
                        <span className="block text-sm text-ink-soft">
                          #{o.id} ·{" "}
                          {[
                            ...new Set(
                              o.payments.map((p) => METHOD_LABEL[p.method]),
                            ),
                          ].join(" + ") || "No payment"}
                        </span>
                      </span>
                      {o.status === "void" && <Badge tone="off">Void</Badge>}
                      <span className="font-semibold tabular">
                        {money(o.total)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm text-ink-soft">
              <span className="tabular">
                page {page} of {pages}
              </span>
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  strong,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border p-3",
        strong
          ? "border-bottle-800 bg-bottle-900 text-white"
          : "border-line bg-surface",
      )}
    >
      <dt
        className={clsx(
          "text-xs",
          strong ? "text-bottle-200" : "text-ink-soft",
        )}
      >
        {label}
      </dt>
      <dd className={clsx("text-lg font-bold tabular", warn && "text-danger")}>
        {value}
      </dd>
    </div>
  );
}
