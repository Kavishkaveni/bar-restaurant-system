"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Ban, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import { CashDrawer, ShiftHistory } from "@/components/money/CashDrawer";
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  Select,
  Spinner,
  Tabs,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayISO, useMoney } from "@/lib/money";
import type {
  Expense,
  ExpenseCategory,
  ExpenseMethod,
  ExpensePage,
} from "@/lib/types";

type Tab = "expenses" | "drawer" | "categories";

const EXPENSE_METHODS: { key: ExpenseMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "card", label: "Card" },
  { key: "cheque", label: "Cheque" },
  { key: "qr", label: "QR" },
];

export default function ExpensesPage() {
  const { can } = useAuth();
  const manager = can("expenses.manage");
  const [tab, setTab] = useState<Tab>(manager ? "expenses" : "drawer");
  const tabs: { key: Tab; label: string }[] = manager
    ? [
        { key: "expenses", label: "Expenses" },
        { key: "drawer", label: "Cash drawer" },
        { key: "categories", label: "Categories" },
      ]
    : [{ key: "drawer", label: "Cash drawer" }];
  return (
    <Guard anyOf={["expenses.manage", "pos.payment"]}>
      <PageHeader
        title={manager ? "Expenses and cash" : "Cash drawer"}
        description={
          manager
            ? "What the business spends, and the cash at the counter."
            : undefined
        }
      />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {tab === "expenses" && <Expenses />}
      {tab === "drawer" && (
        <div className="space-y-8">
          <CashDrawer />
          {(manager || can("dashboard.view")) && (
            <section>
              <h2 className="mb-3 font-semibold">Past shifts</h2>
              <ShiftHistory />
            </section>
          )}
        </div>
      )}
      {tab === "categories" && <Categories />}
    </Guard>
  );
}

function monthStart(): string {
  return todayISO().slice(0, 8) + "01";
}

function Expenses() {
  const money = useMoney();
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(todayISO());
  const [category, setCategory] = useState<number | "">("");
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const cats = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api<ExpenseCategory[]>("/expense-categories"),
  });
  const page = useQuery({
    queryKey: ["expenses", start, end, category],
    queryFn: () =>
      api<ExpensePage>(
        `/expenses?start=${start}&end=${end}${category ? `&category_id=${category}` : ""}&include_void=true`,
      ),
  });
  const d = page.data;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Field label="From">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value || monthStart())}
              />
            )}
          </Field>
        </div>
        <div className="w-40">
          <Field label="To">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={end}
                max={todayISO()}
                onChange={(e) => setEnd(e.target.value || todayISO())}
              />
            )}
          </Field>
        </div>
        <div className="w-52">
          <Field label="Category">
            {(id) => (
              <Select
                id={id}
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">All</option>
                {cats.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button className="sm:ml-auto" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden /> Add expense
        </Button>
      </div>

      {!d ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-xl bg-bottle-900 px-4 py-2 text-white">
              <span className="block text-xs text-bottle-200">Total</span>
              <span className="text-lg font-bold tabular">
                {money(d.total)}
              </span>
            </span>
            {d.by_category.map((c) => (
              <span
                key={c.category_id}
                className="rounded-xl border border-line bg-surface px-4 py-2"
              >
                <span className="block text-xs text-ink-soft">{c.name}</span>
                <span className="font-semibold tabular">{money(c.amount)}</span>
              </span>
            ))}
          </div>
          {d.items.length === 0 ? (
            <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
              No expenses in these dates.
            </Panel>
          ) : (
            <Panel>
              <ul className="divide-y divide-line">
                {d.items.map((e) => (
                  <li
                    key={e.id}
                    className={clsx(
                      "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3",
                      e.is_void && "opacity-55",
                    )}
                  >
                    <span className="w-24 shrink-0 text-sm text-ink-soft">
                      {formatDate(e.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {e.category.name}
                        {e.shift_id && (
                          <Badge tone="neutral">
                            <Wallet
                              className="mr-1 inline size-3"
                              aria-hidden
                            />
                            From drawer
                          </Badge>
                        )}
                        {e.is_void && <Badge tone="off">Cancelled</Badge>}
                      </span>
                      <span className="block text-sm text-ink-soft">
                        {[
                          e.payee,
                          EXPENSE_METHODS.find((m) => m.key === e.method)
                            ?.label,
                          e.note,
                          e.is_void ? `Cancelled: ${e.void_reason}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        "font-semibold tabular",
                        e.is_void && "line-through",
                      )}
                    >
                      {money(e.amount)}
                    </span>
                    {!e.is_void && (
                      <span className="flex">
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${e.category.name} expense`}
                          onClick={() => setEditing(e)}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Cancel ${e.category.name} expense`}
                          onClick={() => setVoiding(e)}
                        >
                          <Ban className="size-4" aria-hidden />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
      <ExpenseForm
        key={editing === "new" ? "new" : (editing?.id ?? "none")}
        editing={editing}
        categories={cats.data ?? []}
        onClose={() => setEditing(null)}
      />
      <VoidExpense expense={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}

function ExpenseForm({
  editing,
  categories,
  onClose,
}: {
  editing: Expense | "new" | null;
  categories: ExpenseCategory[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const e = editing && editing !== "new" ? editing : null;
  const [category, setCategory] = useState<number | "">(e?.category.id ?? "");
  const [date, setDate] = useState(e?.date ?? todayISO());
  const [amount, setAmount] = useState(e ? String(e.amount) : "");
  const [method, setMethod] = useState<ExpenseMethod>(e?.method ?? "cash");
  const [payee, setPayee] = useState(e?.payee ?? "");
  const [note, setNote] = useState(e?.note ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const body = {
        category_id: category,
        date,
        amount: Number(amount),
        method,
        payee,
        note,
        from_drawer: e ? e.shift_id !== null : false,
      };
      return e
        ? api(`/expenses/${e.id}`, { method: "PUT", json: body })
        : api("/expenses", { method: "POST", json: body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not save"),
  });
  const fromDrawer = e?.shift_id != null;
  return (
    <Modal
      open={editing !== null}
      title={e ? "Edit expense" : "Add expense"}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          setError("");
          save.mutate();
        }}
      >
        {!e && (
          <p className="text-sm text-ink-soft">
            For money paid from the counter cash, use Pay out on the Cash drawer
            tab instead, so the drawer count stays right.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            {(id) => (
              <Select
                id={id}
                value={category}
                onChange={(ev) => setCategory(Number(ev.target.value))}
                required
              >
                <option value="" disabled>
                  Choose
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Amount">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(ev) => setAmount(ev.target.value)}
                required
                className="tabular"
              />
            )}
          </Field>
          <Field label="Date">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={date}
                max={todayISO()}
                onChange={(ev) => setDate(ev.target.value)}
                required
                disabled={fromDrawer}
              />
            )}
          </Field>
          <Field label="Paid by">
            {(id) => (
              <Select
                id={id}
                value={method}
                onChange={(ev) => setMethod(ev.target.value as ExpenseMethod)}
                disabled={fromDrawer}
              >
                {EXPENSE_METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Paid to (optional)">
            {(id) => (
              <Input
                id={id}
                value={payee}
                onChange={(ev) => setPayee(ev.target.value)}
                placeholder="e.g. CEB, Landlord"
                maxLength={120}
              />
            )}
          </Field>
          <Field label="Note (optional)">
            {(id) => (
              <Input
                id={id}
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                placeholder="e.g. September bill"
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
            {e ? "Save changes" : "Add expense"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function VoidExpense({
  expense,
  onClose,
}: {
  expense: Expense | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const money = useMoney();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/expenses/${expense!.id}/void`, {
        method: "POST",
        json: { reason },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      setReason("");
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not cancel"),
  });
  return (
    <Modal open={expense !== null} title="Cancel expense" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          setError("");
          save.mutate();
        }}
      >
        <p className="text-sm">
          {expense?.category.name}, {money(expense?.amount)} on{" "}
          {expense && formatDate(expense.date)}. It stays in the list, crossed
          out.
        </p>
        <Field label="Reason">
          {(id) => (
            <Input
              id={id}
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              required
              minLength={2}
              maxLength={300}
              placeholder="e.g. Entered twice"
            />
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button type="submit" variant="danger" busy={save.isPending}>
            Cancel expense
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Categories() {
  const qc = useQueryClient();
  const cats = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api<ExpenseCategory[]>("/expense-categories"),
  });
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["expense-categories"] });
  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : "Could not save");
  const add = useMutation({
    mutationFn: () =>
      api("/expense-categories", { method: "POST", json: { name } }),
    onSuccess: () => {
      setName("");
      setError("");
      refresh();
    },
    onError,
  });
  const rename = useMutation({
    mutationFn: () =>
      api(`/expense-categories/${renaming!.id}`, {
        method: "PUT",
        json: { name: renaming!.name },
      }),
    onSuccess: () => {
      setRenaming(null);
      setError("");
      refresh();
    },
    onError,
  });
  const del = useMutation({
    mutationFn: (id: number) =>
      api(`/expense-categories/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError,
  });

  if (cats.isLoading) return <Spinner />;
  return (
    <div className="max-w-xl space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category, e.g. Generator fuel"
          required
          maxLength={60}
          aria-label="New category name"
        />
        <Button type="submit" busy={add.isPending}>
          <Plus className="size-4" aria-hidden /> Add
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
      <Panel>
        <ul className="divide-y divide-line">
          {cats.data?.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2">
              {renaming?.id === c.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate();
                  }}
                >
                  <Input
                    value={renaming.name}
                    onChange={(e) =>
                      setRenaming({ id: c.id, name: e.target.value })
                    }
                    required
                    maxLength={60}
                    autoFocus
                    aria-label="Category name"
                  />
                  <Button type="submit" busy={rename.isPending}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setRenaming(null)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1">{c.name}</span>
                  <Button
                    variant="ghost"
                    aria-label={`Rename ${c.name}`}
                    onClick={() => setRenaming({ id: c.id, name: c.name })}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => del.mutate(c.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <p className="text-sm text-ink-soft">
        Deleting a category hides it for new expenses. Past expenses keep it.
      </p>
    </div>
  );
}
