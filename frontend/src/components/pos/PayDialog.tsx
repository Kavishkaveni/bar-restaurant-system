"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Banknote,
  BedDouble,
  CheckCircle2,
  CreditCard,
  Landmark,
  Printer,
  QrCode,
  Users,
} from "lucide-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/pos";
import type { BookingBrief, Order, PaymentMethod } from "@/lib/types";

const METHODS: { key: PaymentMethod; icon: typeof Banknote }[] = [
  { key: "cash", icon: Banknote },
  { key: "card", icon: CreditCard },
  { key: "bank_transfer", icon: Landmark },
  { key: "qr", icon: QrCode },
  { key: "room", icon: BedDouble },
];

/** Cash notes in Sri Lanka; quick buttons round up to these. */
const NOTES = [100, 500, 1000, 2000, 5000];

function quickCash(due: number): number[] {
  const options = new Set<number>([due]);
  for (const n of NOTES) options.add(Math.ceil(due / n) * n);
  return [...options]
    .filter((v) => v >= due)
    .sort((a, b) => a - b)
    .slice(0, 4);
}

export function PayDialog({
  order,
  open,
  onClose,
  onPaid,
  onPrintReceipt,
  onDone,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  onPaid: (o: Order) => void;
  onPrintReceipt: () => void;
  onDone: () => void;
}) {
  return (
    <Modal
      open={open}
      title={order.status === "paid" ? "Paid" : `Pay ${order.label}`}
      onClose={onClose}
    >
      {open && (
        <Body
          key={order.id}
          order={order}
          onPaid={onPaid}
          onPrintReceipt={onPrintReceipt}
          onDone={onDone}
        />
      )}
    </Modal>
  );
}

function Body({
  order,
  onPaid,
  onPrintReceipt,
  onDone,
}: {
  order: Order;
  onPaid: (o: Order) => void;
  onPrintReceipt: () => void;
  onDone: () => void;
}) {
  const money = useMoney();
  const { can } = useAuth();
  const takesMoney = can("pos.payment");
  const canRoom = takesMoney || can("pos.room_service");
  const guests = useQuery({
    queryKey: ["in-house"],
    queryFn: () => api<BookingBrief[]>("/bookings/in-house"),
    enabled: canRoom && order.status === "open",
  });
  const [method, setMethod] = useState<PaymentMethod>(
    order.type === "room" || !takesMoney ? "room" : "cash",
  );
  const [stay, setStay] = useState<number | "">(order.booking_id ?? "");
  const [amount, setAmount] = useState(String(order.due));
  const [tendered, setTendered] = useState("");
  const [tip, setTip] = useState("");
  const [showTip, setShowTip] = useState(false);
  const [reference, setReference] = useState("");
  const [people, setPeople] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastChange, setLastChange] = useState(0);

  if (!canRoom) {
    return (
      <p className="text-sm">
        Your role can&apos;t take payments. Ask a cashier or manager to close
        this bill.
      </p>
    );
  }
  const roomGuests = guests.data ?? [];
  const methods = METHODS.filter((m) =>
    m.key === "room" ? roomGuests.length > 0 || order.booking_id : takesMoney,
  );

  if (order.status === "paid") {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2 className="mx-auto size-14 text-ok" aria-hidden />
        <div>
          <p className="text-lg font-semibold">Bill paid</p>
          <p className="text-sm text-ink-soft tabular">{money(order.total)}</p>
        </div>
        {order.payments.some((p) => p.method === "room") && (
          <p className="rounded-xl bg-bottle-100 p-4 font-medium text-bottle-800">
            Added to the{" "}
            {order.payments.find((p) => p.method === "room")?.reference} bill.
            The guest pays at check-out.
          </p>
        )}
        {lastChange > 0 && (
          <div className="rounded-xl bg-amber-100 p-4">
            <p className="text-sm text-amber-600">Give change</p>
            <p className="text-3xl font-bold tabular">{money(lastChange)}</p>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" variant="secondary" onClick={onPrintReceipt}>
            <Printer className="size-5" aria-hidden /> Print receipt
          </Button>
          <Button size="lg" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const amt = Number(amount) || 0;
  const cashGiven = Number(tendered) || 0;
  const change = method === "cash" && cashGiven > amt ? cashGiven - amt : 0;
  const share = people ? Math.ceil((order.due / people) * 100) / 100 : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (method === "room") {
      if (!stay) return setError("Choose the room.");
      setBusy(true);
      try {
        onPaid(
          await api<Order>(`/orders/${order.id}/payments`, {
            method: "POST",
            json: { method: "room", amount: order.due, booking_id: stay },
          }),
        );
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Could not charge the room",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!(amt > 0)) return setError("Enter the amount being paid.");
    if (amt > order.due + 0.001)
      return setError(`Only ${money(order.due)} is due.`);
    if (method === "cash" && tendered && cashGiven < amt)
      return setError("Cash given is less than the amount.");
    setBusy(true);
    try {
      const o = await api<Order>(`/orders/${order.id}/payments`, {
        method: "POST",
        json: {
          method,
          amount: amt,
          tendered: method === "cash" && tendered ? cashGiven : null,
          tip: Number(tip) || 0,
          reference,
        },
      });
      setLastChange(change);
      onPaid(o);
      setAmount(String(o.due));
      setTendered("");
      setTip("");
      setReference("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-baseline justify-between rounded-xl bg-bottle-900 px-4 py-3 text-white">
        <span className="text-sm text-bottle-200">
          {order.paid > 0 ? "Still to pay" : "To pay"}
        </span>
        <span className="text-3xl font-bold tabular">{money(order.due)}</span>
      </div>
      {order.paid > 0 && (
        <p className="text-sm text-ink-soft">
          Already paid {money(order.paid)}:{" "}
          {order.payments
            .map((p) => `${METHOD_LABEL[p.method]} ${money(p.amount)}`)
            .join(", ")}
        </p>
      )}

      <div
        className={clsx(
          "grid grid-cols-2 gap-2",
          methods.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4",
        )}
        role="radiogroup"
        aria-label="Payment method"
      >
        {methods.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={method === key}
            onClick={() => setMethod(key)}
            className={clsx(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 text-sm font-semibold",
              method === key
                ? "border-amber-500 bg-amber-100"
                : "border-line hover:bg-ground",
            )}
          >
            <Icon className="size-5" aria-hidden /> {METHOD_LABEL[key]}
          </button>
        ))}
      </div>

      {method === "room" ? (
        <>
          <Field
            label="Room"
            hint="The whole bill goes on the guest's room bill and is paid at check-out."
          >
            {(id) => (
              <Select
                id={id}
                value={stay}
                onChange={(e) => setStay(Number(e.target.value))}
                required
              >
                <option value="" disabled>
                  Choose the room
                </option>
                {roomGuests.map((g) => (
                  <option key={g.id} value={g.id}>
                    Room {g.room.number} · {g.guest_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" size="lg" busy={busy} className="w-full">
            Charge {money(order.due)} to the room
          </Button>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Amount for this payment"
              hint={
                share ? `Split ${people} ways: ${money(share)} each` : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0.01}
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-12 text-lg tabular"
                />
              )}
            </Field>
            {method === "cash" ? (
              <Field label="Cash given">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                    placeholder="Optional"
                    className="h-12 text-lg tabular"
                  />
                )}
              </Field>
            ) : (
              <Field
                label="Reference (optional)"
                hint="Last 4 digits, approval or transfer number"
              >
                {(id) => (
                  <Input
                    id={id}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={80}
                    className="h-12"
                  />
                )}
              </Field>
            )}
          </div>

          {method === "cash" && (
            <div className="flex flex-wrap gap-2">
              {quickCash(amt || order.due).map((v) => (
                <Button
                  key={v}
                  type="button"
                  variant="secondary"
                  onClick={() => setTendered(String(v))}
                >
                  {money(v)}
                </Button>
              ))}
            </div>
          )}
          {change > 0 && (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-lg font-semibold">
              Change: <span className="tabular">{money(change)}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Users className="size-4 text-ink-soft" aria-hidden />
            <span className="text-ink-soft">Split equally:</span>
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setPeople(n);
                  setAmount(
                    String(
                      Math.min(
                        order.due,
                        Math.ceil((order.due / n) * 100) / 100,
                      ),
                    ),
                  );
                }}
                className={clsx(
                  "h-8 rounded-full px-3 font-semibold ring-1",
                  people === n
                    ? "bg-bottle-900 text-white ring-bottle-900"
                    : "ring-line hover:bg-ground",
                )}
              >
                {n}
              </button>
            ))}
            {!showTip && (
              <button
                type="button"
                onClick={() => setShowTip(true)}
                className="ml-auto text-ink-soft underline-offset-4 hover:underline"
              >
                Add tip
              </button>
            )}
          </div>
          {showTip && (
            <div className="max-w-48">
              <Field label="Tip" hint="Kept separate from the bill total.">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    step="0.01"
                    value={tip}
                    onChange={(e) => setTip(e.target.value)}
                    className="tabular"
                  />
                )}
              </Field>
            </div>
          )}

          <ErrorText>{error}</ErrorText>
          <Button type="submit" size="lg" busy={busy} className="w-full">
            {amt >= order.due
              ? `Take ${money(amt)} and close bill`
              : `Take ${money(amt)}`}
          </Button>
        </>
      )}
    </form>
  );
}
