"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calculator,
  HandCoins,
  LockKeyhole,
  Wallet,
} from "lucide-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Spinner,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { timeOf } from "@/lib/pos";
import type { ExpenseCategory, Shift } from "@/lib/types";

export function useCurrentShift(enabled = true) {
  return useQuery({
    queryKey: ["shift", "current"],
    queryFn: () => api<Shift | null>("/shifts/current"),
    refetchInterval: 30_000,
    enabled,
  });
}

/** The counter cash drawer: open it with a float, pay out, count and close. */
export function CashDrawer() {
  const money = useMoney();
  const { can } = useAuth();
  const shift = useCurrentShift();
  const [dialog, setDialog] = useState<"payout" | "move" | "close" | null>(
    null,
  );
  const [closed, setClosed] = useState<Shift | null>(null);
  const cashier = can("pos.payment") || can("expenses.manage");

  if (shift.isLoading) return <Spinner />;
  const s = shift.data;

  if (!s) {
    return (
      <div className="space-y-4">
        {closed && <ClosedResult shift={closed} />}
        {cashier ? (
          <OpenForm />
        ) : (
          <Panel className="p-6 text-sm text-ink-soft">
            The cash drawer is closed.
          </Panel>
        )}
      </div>
    );
  }

  const d = s.drawer;
  const rows: [string, number, "+" | "−"][] = [
    ["Opening float", d.opening_float, "+"],
    ["Cash from bills (with tips)", d.cash_sales, "+"],
    ["Room payments in cash", d.room_cash, "+"],
    ["Cash put in", d.cash_in, "+"],
    ["Bills voided (cash given back)", d.cash_refunds, "−"],
    ["Room refunds", d.room_refunds, "−"],
    ["Paid out (expenses)", d.paid_out, "−"],
    ["Cash taken out", d.cash_out, "−"],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Panel className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">
              Open since {timeOf(s.opened_at)} · {s.opener?.name}
            </p>
            <p className="mt-3 text-sm text-ink-soft">
              Should be in the drawer now
            </p>
            <p className="text-4xl font-bold tabular">{money(d.expected)}</p>
          </div>
          <Wallet className="size-8 text-amber-500" aria-hidden />
        </div>
        <dl className="mt-5 space-y-1.5 text-sm">
          {rows
            .filter(([, v], i) => v !== 0 || i === 0)
            .map(([label, v, sign]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="tabular">
                  {sign === "−" ? "− " : ""}
                  {money(v)}
                </dd>
              </div>
            ))}
        </dl>
        {cashier && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="lg" onClick={() => setDialog("close")}>
              <Calculator className="size-5" aria-hidden /> Count and close
            </Button>
            <Button variant="secondary" onClick={() => setDialog("payout")}>
              <HandCoins className="size-4" aria-hidden /> Pay out
            </Button>
            <Button variant="secondary" onClick={() => setDialog("move")}>
              <ArrowUpFromLine className="size-4" aria-hidden /> Cash in / out
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 font-semibold">During this shift</h3>
        {s.movements.length === 0 && s.payouts.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No pay-outs or cash moved yet.
          </p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {s.payouts.map((e) => (
              <li
                key={`e${e.id}`}
                className={clsx(
                  "flex justify-between gap-3 py-2",
                  e.is_void && "line-through opacity-60",
                )}
              >
                <span>
                  Paid out: {e.category.name}
                  {e.payee && ` · ${e.payee}`}
                  <span className="block text-xs text-ink-soft">
                    {timeOf(e.created_at)} · {e.user?.name}
                  </span>
                </span>
                <span className="tabular">− {money(e.amount)}</span>
              </li>
            ))}
            {s.movements.map((m) => (
              <li key={`m${m.id}`} className="flex justify-between gap-3 py-2">
                <span>
                  {m.kind === "in" ? "Put in" : "Taken out"}: {m.reason}
                  <span className="block text-xs text-ink-soft">
                    {timeOf(m.created_at)} · {m.user?.name}
                  </span>
                </span>
                <span className="tabular">
                  {m.kind === "in" ? "+ " : "− "}
                  {money(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PayOutDialog
        open={dialog === "payout"}
        onClose={() => setDialog(null)}
        max={d.expected}
      />
      <MoveDialog
        open={dialog === "move"}
        shift={s}
        onClose={() => setDialog(null)}
      />
      <CloseDialog
        open={dialog === "close"}
        shift={s}
        onClose={() => setDialog(null)}
        onClosed={(x) => {
          setClosed(x);
          setDialog(null);
        }}
      />
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["shift"] });
    qc.invalidateQueries({ queryKey: ["shifts"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };
}

function OpenForm() {
  const refresh = useRefresh();
  const [float, setFloat] = useState("");
  const [error, setError] = useState("");
  const open = useMutation({
    mutationFn: () =>
      api<Shift>("/shifts", {
        method: "POST",
        json: { opening_float: Number(float) || 0 },
      }),
    onSuccess: refresh,
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not open"),
  });
  return (
    <Panel className="max-w-lg p-5">
      <div className="flex items-center gap-3">
        <LockKeyhole className="size-6 text-ink-soft" aria-hidden />
        <div>
          <p className="font-semibold">The cash drawer is closed</p>
          <p className="text-sm text-ink-soft">
            Count the change in the drawer and open a shift before taking cash.
          </p>
        </div>
      </div>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          open.mutate();
        }}
      >
        <div className="w-48">
          <Field label="Change in the drawer (float)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={float}
                onChange={(e) => setFloat(e.target.value)}
                placeholder="0"
                className="tabular"
                autoFocus
              />
            )}
          </Field>
        </div>
        <Button type="submit" size="lg" busy={open.isPending}>
          Open cash drawer
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}

function PayOutDialog({
  open,
  onClose,
  max,
}: {
  open: boolean;
  onClose: () => void;
  max: number;
}) {
  const money = useMoney();
  const refresh = useRefresh();
  const cats = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api<ExpenseCategory[]>("/expense-categories"),
    enabled: open,
  });
  const [category, setCategory] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const today = new Date();
      const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      return api("/expenses", {
        method: "POST",
        json: {
          category_id: category,
          date: day,
          amount: Number(amount),
          from_drawer: true,
          payee,
          note,
        },
      });
    },
    onSuccess: () => {
      refresh();
      setAmount("");
      setPayee("");
      setNote("");
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  return (
    <Modal open={open} title="Pay out from the drawer" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
      >
        <p className="text-sm text-ink-soft">
          For small things paid in cash from the counter, like transport or a
          delivery. It&apos;s recorded as an expense.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What for">
            {(id) => (
              <Select
                id={id}
                value={category}
                onChange={(e) => setCategory(Number(e.target.value))}
                required
              >
                <option value="" disabled>
                  Choose
                </option>
                {cats.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Amount" hint={`Up to ${money(max)}`}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="tabular"
              />
            )}
          </Field>
          <Field label="Paid to (optional)">
            {(id) => (
              <Input
                id={id}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                maxLength={120}
              />
            )}
          </Field>
          <Field label="Note (optional)">
            {(id) => (
              <Input
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
              />
            )}
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending}>
            Pay out
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MoveDialog({
  open,
  shift,
  onClose,
}: {
  open: boolean;
  shift: Shift;
  onClose: () => void;
}) {
  const refresh = useRefresh();
  const [kind, setKind] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/shifts/${shift.id}/cash`, {
        method: "POST",
        json: { kind, amount: Number(amount), reason },
      }),
    onSuccess: () => {
      refresh();
      setAmount("");
      setReason("");
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  return (
    <Modal open={open} title="Cash in or out" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              [
                "out",
                "Take cash out",
                "To the safe, or the owner takes it",
                ArrowUpFromLine,
              ],
              [
                "in",
                "Put cash in",
                "More change added to the drawer",
                ArrowDownToLine,
              ],
            ] as const
          ).map(([k, t, d, Icon]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={clsx(
                "rounded-lg border p-3 text-left text-sm",
                kind === k
                  ? "border-amber-500 bg-amber-100/40"
                  : "border-line hover:bg-ground",
              )}
            >
              <Icon className="mb-1 size-4" aria-hidden />
              <span className="block font-medium">{t}</span>
              <span className="block text-ink-soft">{d}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="tabular"
              />
            )}
          </Field>
          <Field label="Reason">
            {(id) => (
              <Input
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  kind === "out"
                    ? "e.g. To the safe"
                    : "e.g. Change from the bank"
                }
                required
                minLength={2}
                maxLength={200}
              />
            )}
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Sri Lankan notes and coins, for counting the drawer. */
const DENOMS = [5000, 2000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

function CloseDialog({
  open,
  shift,
  onClose,
  onClosed,
}: {
  open: boolean;
  shift: Shift;
  onClose: () => void;
  onClosed: (s: Shift) => void;
}) {
  const money = useMoney();
  const refresh = useRefresh();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const fromNotes = DENOMS.reduce(
    (sum, d) => sum + d * (Number(counts[d]) || 0),
    0,
  );
  const counted = typed !== "" ? Number(typed) || 0 : fromNotes;
  const diff = Math.round((counted - shift.drawer.expected) * 100) / 100;

  const close = useMutation({
    mutationFn: () =>
      api<Shift>(`/shifts/${shift.id}/close`, {
        method: "POST",
        json: { counted_cash: counted, note },
      }),
    onSuccess: (s) => {
      refresh();
      setCounts({});
      setTyped("");
      setNote("");
      onClosed(s);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not close"),
  });

  return (
    <Modal
      open={open}
      title="Count the drawer and close"
      onClose={onClose}
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          close.mutate();
        }}
      >
        <p className="text-sm text-ink-soft">
          Count the notes and coins. Type how many of each, or type the total.
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {DENOMS.map((d) => (
            <label
              key={d}
              className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm"
            >
              <span className="w-12 shrink-0 text-right font-medium tabular">
                {d}
              </span>
              <span className="text-ink-soft">×</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={counts[d] ?? ""}
                onChange={(e) => {
                  setTyped("");
                  setCounts((c) => ({ ...c, [d]: e.target.value }));
                }}
                className="w-full min-w-0 bg-transparent text-right tabular outline-none"
                aria-label={`Number of ${d} notes or coins`}
              />
            </label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total counted">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={
                  typed !== "" ? typed : fromNotes ? String(fromNotes) : ""
                }
                onChange={(e) => setTyped(e.target.value)}
                required
                className="h-12 text-lg tabular"
              />
            )}
          </Field>
          <Field label="Note (optional)">
            {(id) => (
              <Input
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                className="h-12"
              />
            )}
          </Field>
        </div>
        <div
          className={clsx(
            "flex items-baseline justify-between rounded-xl px-4 py-3",
            diff === 0
              ? "bg-ok-soft text-ok"
              : diff < 0
                ? "bg-danger-soft text-danger"
                : "bg-amber-100 text-amber-600",
          )}
        >
          <span className="text-sm">
            Should be {money(shift.drawer.expected)} ·{" "}
            <span className="font-semibold">
              {diff === 0 ? "Exact" : diff < 0 ? "Short" : "Over"}
            </span>
          </span>
          <span className="text-2xl font-bold tabular">
            {diff === 0 ? "✓" : money(Math.abs(diff))}
          </span>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={close.isPending}>
            Close the shift
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClosedResult({ shift }: { shift: Shift }) {
  const money = useMoney();
  const diff = shift.difference ?? 0;
  return (
    <Panel
      className={clsx(
        "max-w-lg p-5",
        diff < 0
          ? "border-danger"
          : diff > 0
            ? "border-amber-500"
            : "border-ok",
      )}
    >
      <p className="font-semibold">Shift closed</p>
      <p className="mt-1 text-sm">
        Counted {money(shift.counted_cash)}, should have been{" "}
        {money(shift.drawer.expected)}.{" "}
        <span
          className={clsx(
            "font-semibold",
            diff < 0 ? "text-danger" : diff > 0 ? "text-amber-600" : "text-ok",
          )}
        >
          {diff === 0
            ? "Exact."
            : diff < 0
              ? `Short by ${money(-diff)}.`
              : `Over by ${money(diff)}.`}
        </span>
      </p>
    </Panel>
  );
}

/** Closed shifts with what was expected and what was counted. */
export function ShiftHistory() {
  const money = useMoney();
  const shifts = useQuery({
    queryKey: ["shifts", "history"],
    queryFn: () => api<Shift[]>("/shifts?days=31"),
  });
  if (shifts.isLoading) return <Spinner />;
  const list = (shifts.data ?? []).filter((s) => s.status === "closed");
  if (!list.length)
    return (
      <p className="text-sm text-ink-soft">
        No closed shifts in the last month.
      </p>
    );
  return (
    <Panel>
      <ul className="divide-y divide-line">
        {list.map((s) => {
          const diff = s.difference ?? 0;
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {new Date(s.opened_at).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  · {timeOf(s.opened_at)}–{s.closed_at && timeOf(s.closed_at)}
                </span>
                <span className="block text-ink-soft">
                  {s.opener?.name}
                  {s.closer &&
                    s.closer.id !== s.opener?.id &&
                    ` → ${s.closer.name}`}
                  {s.note && ` · ${s.note}`}
                </span>
              </span>
              <span className="text-right tabular">
                <span className="block">
                  Expected {money(s.drawer.expected)}
                </span>
                <span className="block text-ink-soft">
                  Counted {money(s.counted_cash)}
                </span>
              </span>
              <span
                className={clsx(
                  "w-28 text-right font-semibold tabular",
                  diff < 0
                    ? "text-danger"
                    : diff > 0
                      ? "text-amber-600"
                      : "text-ok",
                )}
              >
                {diff === 0
                  ? "Exact"
                  : diff < 0
                    ? `Short ${money(-diff)}`
                    : `Over ${money(diff)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
