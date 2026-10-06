"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Download, Printer, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Guard } from "@/components/Guard";
import {
  Button,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Panel,
  Spinner,
  Tabs,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayISO, useMoney } from "@/lib/money";
import { addDays } from "@/lib/rooms";
import type { StockRow, Summary } from "@/lib/types";

type Preset =
  "today" | "yesterday" | "week" | "month" | "last_month" | "custom";

function presetRange(p: Preset): [string, string] {
  const today = todayISO();
  if (p === "yesterday") return [addDays(today, -1), addDays(today, -1)];
  if (p === "week") return [addDays(today, -6), today];
  if (p === "month") return [today.slice(0, 8) + "01", today];
  if (p === "last_month") {
    const firstThis = today.slice(0, 8) + "01";
    const lastPrev = addDays(firstThis, -1);
    return [lastPrev.slice(0, 8) + "01", lastPrev];
  }
  return [today, today];
}

export default function ReportsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"summary" | "stock">("summary");
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState<[string, string]>(presetRange("today"));
  const [start, end] = range;
  const tabs: { key: "summary" | "stock"; label: string }[] = [];
  if (can("dashboard.view") || can("dashboard.profit"))
    tabs.push({ key: "summary", label: "Sales and profit" });
  tabs.push({ key: "stock", label: "Stock movement" });

  return (
    <Guard anyOf={["dashboard.view", "dashboard.profit", "catalogue.manage"]}>
      <style>{`@media print { aside, header, .no-print { display: none !important; } main { padding: 0 !important; } body { background: #fff !important; } }`}</style>
      <PageHeader
        title="Reports"
        description={
          start === end
            ? formatDate(start)
            : `${formatDate(start)} to ${formatDate(end)}`
        }
        action={
          <Button
            variant="secondary"
            className="no-print"
            onClick={() => window.print()}
          >
            <Printer className="size-4" aria-hidden /> Print
          </Button>
        }
      />
      <div className="no-print mb-4 flex flex-wrap items-end gap-2">
        {(
          [
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["week", "Last 7 days"],
            ["month", "This month"],
            ["last_month", "Last month"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setPreset(k);
              setRange(presetRange(k));
            }}
            className={clsx(
              "h-9 rounded-full px-4 text-sm font-semibold ring-1",
              preset === k
                ? "bg-bottle-900 text-white ring-bottle-900"
                : "ring-line hover:bg-ground",
            )}
          >
            {label}
          </button>
        ))}
        <div className="flex items-end gap-2 sm:ml-auto">
          <div className="w-38">
            <Field label="From">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={start}
                  max={end}
                  onChange={(e) => {
                    setPreset("custom");
                    setRange([e.target.value || start, end]);
                  }}
                />
              )}
            </Field>
          </div>
          <div className="w-38">
            <Field label="To">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={end}
                  min={start}
                  max={todayISO()}
                  onChange={(e) => {
                    setPreset("custom");
                    setRange([start, e.target.value || end]);
                  }}
                />
              )}
            </Field>
          </div>
        </div>
      </div>
      {tabs.length > 1 && (
        <div className="no-print">
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
      )}
      {tab === "summary" && tabs.some((t) => t.key === "summary") ? (
        <SummaryView start={start} end={end} />
      ) : (
        <StockView start={start} end={end} />
      )}
    </Guard>
  );
}

// ---- Sales and profit -----------------------------------------------------------------

function SummaryView({ start, end }: { start: string; end: string }) {
  const money = useMoney();
  const q = useQuery({
    queryKey: ["report", start, end],
    queryFn: () => api<Summary>(`/reports/summary?start=${start}&end=${end}`),
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error)
    return (
      <ErrorText>
        {q.error instanceof ApiError
          ? q.error.message
          : "Could not load the report"}
      </ErrorText>
    );
  const r = q.data!;
  const profit = r.net_profit !== null;
  const moneyIn = r.payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className={clsx("space-y-5", q.isFetching && "opacity-70")}>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Sales (bills)"
          value={money(r.sales_net)}
          sub={`${r.bills} ${r.bills === 1 ? "bill" : "bills"}, before tax`}
        />
        <Kpi
          label="Room income"
          value={money(r.room_income + r.cancellation_income)}
          sub={`${r.stays} ${r.stays === 1 ? "stay" : "stays"}, ${r.nights} ${r.nights === 1 ? "night" : "nights"}`}
        />
        <Kpi label="Expenses" value={money(r.expenses)} />
        {profit ? (
          <Kpi
            label="Profit"
            value={money(r.net_profit)}
            strong
            tone={r.net_profit! < 0 ? "bad" : "good"}
          />
        ) : (
          <Kpi label="Money in" value={money(moneyIn)} strong />
        )}
      </dl>

      <div className="grid gap-5 lg:grid-cols-2">
        {profit && (
          <Panel className="p-5">
            <h2 className="mb-3 font-semibold">How the profit adds up</h2>
            <dl className="space-y-1.5 text-sm">
              <Row
                label="Sales before discounts"
                value={money(r.gross_sales)}
              />
              {r.discounts > 0 && (
                <Row label="Discounts" value={`− ${money(r.discounts)}`} />
              )}
              {r.service_charge > 0 && (
                <Row
                  label="Service charge"
                  value={`+ ${money(r.service_charge)}`}
                />
              )}
              <Row
                label="Cost of what was sold"
                value={`− ${money(r.cost_of_sales)}`}
              />
              <Row
                label="Gross profit on bills"
                value={money(r.gross_profit)}
                strong
              />
              <Row label="Room income" value={`+ ${money(r.room_income)}`} />
              {r.cancellation_income > 0 && (
                <Row
                  label="Kept advances (cancellations)"
                  value={`+ ${money(r.cancellation_income)}`}
                />
              )}
              {r.wastage! > 0 && (
                <Row label="Wastage" value={`− ${money(r.wastage)}`} />
              )}
              {r.stock_adjustments !== 0 && (
                <Row
                  label="Stock count differences"
                  value={`${r.stock_adjustments! < 0 ? "−" : "+"} ${money(Math.abs(r.stock_adjustments!))}`}
                />
              )}
              <Row label="Expenses" value={`− ${money(r.expenses)}`} />
              <Row label="Profit" value={money(r.net_profit)} strong big />
            </dl>
            {r.sales_tax + r.room_tax > 0 && (
              <p className="mt-3 text-xs text-ink-soft">
                Tax collected, not counted as income:{" "}
                {money(r.sales_tax + r.room_tax)}
              </p>
            )}
          </Panel>
        )}

        <Panel className="p-5">
          <h2 className="mb-3 font-semibold">Sales by section</h2>
          <Bars
            items={r.by_section.map((s) => ({
              label: s.label,
              amount: s.amount,
            }))}
            empty="No bills paid."
          />
          <dl className="mt-4 space-y-1 text-sm text-ink-soft">
            {r.tips > 0 && <Row label="Tips" value={money(r.tips)} />}
            {r.voids > 0 && (
              <Row
                label={`Voided bills (${r.voids})`}
                value={money(r.void_amount)}
                warn
              />
            )}
          </dl>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 font-semibold">Money in</h2>
          {r.payments.length === 0 ? (
            <p className="text-sm text-ink-soft">No payments.</p>
          ) : (
            <dl className="space-y-1.5 text-sm">
              {r.payments.map((p) => (
                <Row key={p.key} label={p.label} value={money(p.amount)} />
              ))}
              <Row label="Total" value={money(moneyIn)} strong />
            </dl>
          )}
          <p className="mt-3 text-xs text-ink-soft">
            Bills charged to a room are counted when the guest pays at
            check-out.
          </p>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 font-semibold">Expenses</h2>
          <Bars
            items={r.expenses_by_category.map((c) => ({
              label: c.label,
              amount: c.amount,
            }))}
            empty="No expenses."
          />
        </Panel>

        <Panel className="p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Best sellers</h2>
          {r.top_items.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing sold.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-soft">
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 text-right font-medium">Sold</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.top_items.map((t) => (
                  <tr key={t.name}>
                    <td className="py-2">{t.name}</td>
                    <td className="py-2 text-right tabular">
                      {Math.round(t.qty * 1000) / 1000}
                    </td>
                    <td className="py-2 text-right tabular">
                      {money(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {r.daily.length > 1 && (
          <Panel className="overflow-x-auto p-5 lg:col-span-2">
            <h2 className="mb-3 font-semibold">Day by day</h2>
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-soft">
                  <th className="pb-2 font-medium">Day</th>
                  <th className="pb-2 text-right font-medium">Sales</th>
                  <th className="pb-2 text-right font-medium">Rooms</th>
                  {profit && (
                    <th className="pb-2 text-right font-medium">Cost</th>
                  )}
                  <th className="pb-2 text-right font-medium">Expenses</th>
                  {profit && (
                    <th className="pb-2 text-right font-medium">Profit</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.daily.map((d) => (
                  <tr key={d.day}>
                    <td className="py-2">
                      {new Date(d.day + "T00:00").toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="py-2 text-right tabular">
                      {money(d.sales)}
                    </td>
                    <td className="py-2 text-right tabular">
                      {money(d.rooms)}
                    </td>
                    {profit && (
                      <td className="py-2 text-right tabular">
                        {money(d.cost)}
                      </td>
                    )}
                    <td className="py-2 text-right tabular">
                      {money(d.expenses)}
                    </td>
                    {profit && (
                      <td
                        className={clsx(
                          "py-2 text-right font-semibold tabular",
                          d.profit! < 0 && "text-danger",
                        )}
                      >
                        {money(d.profit)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  strong,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border p-4",
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
      <dd
        className={clsx(
          "text-xl font-bold tabular sm:text-2xl",
          tone === "bad" && "text-red-300",
        )}
      >
        {value}
      </dd>
      {sub && (
        <dd
          className={clsx(
            "text-xs",
            strong ? "text-bottle-200" : "text-ink-soft",
          )}
        >
          {sub}
        </dd>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  big,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  big?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex justify-between gap-3",
        strong && "border-t border-line pt-1.5 font-semibold",
        big && "text-base",
        warn && "text-danger",
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function Bars({
  items,
  empty,
}: {
  items: { label: string; amount: number }[];
  empty: string;
}) {
  const money = useMoney();
  if (!items.length) return <p className="text-sm text-ink-soft">{empty}</p>;
  const max = Math.max(...items.map((i) => i.amount));
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-3">
            <span>{i.label}</span>
            <span className="tabular">
              {money(i.amount)}{" "}
              <span className="text-xs text-ink-soft">
                {total ? Math.round((i.amount / total) * 100) : 0}%
              </span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-ground">
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${max ? (i.amount / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Stock movement --------------------------------------------------------------------

function StockView({ start, end }: { start: string; end: string }) {
  const money = useMoney();
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const rows = useQuery({
    queryKey: ["stock-report", start, end],
    queryFn: () => api<StockRow[]>(`/reports/stock?start=${start}&end=${end}`),
    placeholderData: keepPreviousData,
  });
  const list = useMemo(
    () =>
      (rows.data ?? []).filter(
        (r) =>
          (!lowOnly || r.low) &&
          (!q ||
            `${r.name} ${r.category}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [rows.data, q, lowOnly],
  );
  if (rows.isLoading) return <Spinner />;
  const showValue = list.some((r) => r.closing_value !== null);
  const totalValue = list.reduce((s, r) => s + (r.closing_value ?? 0), 0);
  const totalWaste = list.reduce((s, r) => s + (r.wastage_value ?? 0), 0);

  function downloadCsv() {
    const head = [
      "Item",
      "Category",
      "Start",
      "Received",
      "Sold",
      "Wasted",
      "Count difference",
      "Other",
      "End",
      ...(showValue ? ["Value"] : []),
    ];
    const lines = list.map((r) => [
      r.name,
      r.category,
      r.opening,
      r.received,
      r.sold,
      r.wasted,
      r.adjusted,
      r.other,
      r.closing,
      ...(showValue ? [String(r.closing_value ?? "")] : []),
    ]);
    const csv = [head, ...lines]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search items</span>
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items"
            className="pl-9"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
            className="size-4 accent-amber-500"
          />
          Running low only
        </label>
        <Button
          variant="secondary"
          className="sm:ml-auto"
          onClick={downloadCsv}
          disabled={!list.length}
        >
          <Download className="size-4" aria-hidden /> Download for Excel
        </Button>
      </div>
      {showValue && (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
          <Kpi label="Stock value at the end" value={money(totalValue)} />
          <Kpi label="Wastage in these dates" value={money(totalWaste)} />
        </dl>
      )}
      {list.length === 0 ? (
        <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
          No stocked items match.
        </Panel>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-ground text-left text-xs text-ink-soft">
              <tr>
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 text-right font-medium">Start</th>
                <th className="px-3 py-2.5 text-right font-medium">Received</th>
                <th className="px-3 py-2.5 text-right font-medium">Sold</th>
                <th className="px-3 py-2.5 text-right font-medium">Wasted</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Count diff.
                </th>
                <th className="px-3 py-2.5 text-right font-medium">End</th>
                {showValue && (
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((r) => (
                <tr key={r.item_id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{r.name}</span>
                    {r.low && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-600">
                        Low
                      </span>
                    )}
                    <span className="block text-xs text-ink-soft">
                      {r.category}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {r.opening}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {r.received}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{r.sold}</td>
                  <td
                    className={clsx(
                      "px-3 py-2.5 text-right tabular",
                      r.wasted !== "—" && "text-danger",
                    )}
                  >
                    {r.wasted}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {r.adjusted}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular">
                    {r.closing}
                  </td>
                  {showValue && (
                    <td className="px-4 py-2.5 text-right tabular">
                      {money(r.closing_value)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <p className="mt-3 text-xs text-ink-soft">
        Received includes opening stock and purchases. Sold includes ingredients
        used by dishes. Count diff. is the change made when stock was counted.
      </p>
    </>
  );
}
