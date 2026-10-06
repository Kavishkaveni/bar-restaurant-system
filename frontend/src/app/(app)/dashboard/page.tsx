"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowDownRight,
  ArrowUpRight,
  BedDouble,
  ChefHat,
  PackageX,
  Receipt,
  Wallet,
} from "lucide-react";
import Link from "next/link";

import {
  HourlyChart,
  Legend,
  SERIES,
  TrendChart,
} from "@/components/dashboard/Charts";
import { Guard } from "@/components/Guard";
import { ErrorText, Panel, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { formatDate, useMoney } from "@/lib/money";
import { METHOD_LABEL, timeOf } from "@/lib/pos";
import type { DashboardData } from "@/lib/types";

export default function DashboardPage() {
  return (
    <Guard anyOf={["dashboard.view", "dashboard.profit"]}>
      <Dashboard />
    </Guard>
  );
}

function Dashboard() {
  const money = useMoney();
  const live = useLive();
  // Live updates refresh this the moment something changes; the timer is a fallback.
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/dashboard"),
    refetchInterval: live ? 120_000 : 30_000,
  });

  if (q.isLoading) return <Spinner />;
  if (!q.data)
    return (
      <ErrorText>
        {q.error instanceof ApiError
          ? q.error.message
          : "Could not load the dashboard"}
      </ErrorText>
    );
  const d = q.data;
  const t = d.today;
  const showProfit = t.profit !== null;
  const change =
    t.sales_yesterday > 0
      ? ((t.sales - t.sales_yesterday) / t.sales_yesterday) * 100
      : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-ink-soft">{formatDate(d.day)}</p>
        </div>
        <p
          className="flex items-center gap-2 text-xs text-ink-soft"
          aria-live="polite"
        >
          <span
            className={clsx(
              "size-2 rounded-full",
              live ? "bg-ok" : "bg-amber-500",
            )}
            aria-hidden
          />
          {live ? "Live" : "Reconnecting…"} · updated {timeOf(d.updated_at)}
        </p>
      </div>

      {/* Today */}
      <section className="grid gap-3 lg:grid-cols-[1.3fr_2fr]">
        <div className="flex flex-col justify-between rounded-xl bg-bottle-900 p-5 text-white">
          <div>
            <p className="text-sm text-bottle-200">Sales today</p>
            <p className="mt-1 text-5xl font-bold tracking-tight">
              {money(t.sales)}
            </p>
            <p className="mt-2 text-sm text-bottle-200">
              {t.bills} {t.bills === 1 ? "bill" : "bills"}
              {t.bills > 0 && ` · ${money(t.average_bill)} average`}
            </p>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-sm">
            {change === null ? (
              <span className="text-bottle-200">
                No sales by this time yesterday
              </span>
            ) : (
              <>
                {change >= 0 ? (
                  <ArrowUpRight
                    className="size-4 text-emerald-300"
                    aria-hidden
                  />
                ) : (
                  <ArrowDownRight className="size-4 text-red-300" aria-hidden />
                )}
                <span
                  className={clsx(
                    "font-semibold",
                    change >= 0 ? "text-emerald-300" : "text-red-300",
                  )}
                >
                  {change >= 0 ? "Up" : "Down"} {Math.abs(Math.round(change))}%
                </span>
                <span className="text-bottle-200">
                  vs this time yesterday ({money(t.sales_yesterday)})
                </span>
              </>
            )}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {showProfit ? (
            <Tile
              label="Profit today"
              value={money(t.profit)}
              tone={t.profit! < 0 ? "bad" : undefined}
              hint="Sales and rooms, less cost and expenses"
            />
          ) : (
            <Tile label="Money in" value={money(t.money_in)} />
          )}
          <Tile
            label="Room income"
            value={money(t.rooms)}
            hint="Checked out today"
          />
          <Tile label="Expenses" value={money(t.expenses)} />
          {showProfit ? (
            <Tile label="Cost of sales" value={money(t.cost)} />
          ) : (
            <Tile label="Bills" value={String(t.bills)} />
          )}
        </dl>
      </section>

      {/* Charts */}
      <section className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Sales by hour</h2>
            <Legend
              items={[
                { label: "Today", color: SERIES.bills },
                { label: "Yesterday", color: SERIES.past },
              ]}
            />
          </div>
          <HourlyChart data={d.hourly} />
        </Panel>
        <Panel className="p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Last 30 days</h2>
            <Legend
              items={[
                { label: "Bills", color: SERIES.bills },
                { label: "Rooms", color: SERIES.rooms },
                ...(showProfit
                  ? [{ label: "Profit", color: SERIES.profit, line: true }]
                  : []),
              ]}
            />
          </div>
          <TrendChart data={d.trend} />
          <Link
            href="/reports"
            className="mt-2 inline-block text-xs text-ink-soft underline underline-offset-4"
          >
            See the numbers as a table in Reports
          </Link>
        </Panel>
      </section>

      {/* Right now */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <NowCard icon={BedDouble} title="Rooms" href="/rooms">
          <p className="text-3xl font-bold tabular">
            {d.rooms.occupied}
            <span className="text-lg font-semibold text-ink-soft">
              {" "}
              / {d.rooms.total}
            </span>
          </p>
          <p className="text-sm text-ink-soft">occupied</p>
          {d.rooms.total > 0 && (
            <div
              className="mt-2 h-2 rounded-full bg-bottle-100"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={d.rooms.total}
              aria-valuenow={d.rooms.occupied}
              aria-label="Rooms occupied"
            >
              <div
                className="h-full rounded-full bg-bottle-700"
                style={{
                  width: `${(d.rooms.occupied / d.rooms.total) * 100}%`,
                }}
              />
            </div>
          )}
          <ul className="mt-3 space-y-0.5 text-sm">
            <Small label="Arriving today" value={d.rooms.arriving} />
            <Small label="Leaving today" value={d.rooms.leaving} />
            <Small
              label="To clean"
              value={d.rooms.to_clean}
              warn={d.rooms.to_clean > 0}
            />
            {d.rooms.maintenance > 0 && (
              <Small label="Maintenance" value={d.rooms.maintenance} warn />
            )}
          </ul>
        </NowCard>

        <NowCard icon={Receipt} title="Open bills" href="/pos">
          <p className="text-3xl font-bold tabular">{d.open_bills}</p>
          <p className="text-sm text-ink-soft">
            {money(d.open_total)} not paid yet
          </p>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <ChefHat className="size-4 text-ink-soft" aria-hidden />
            <span>
              Kitchen:{" "}
              <span className="font-semibold tabular">{d.kitchen.new}</span>{" "}
              new,{" "}
              <span className="font-semibold tabular">
                {d.kitchen.preparing}
              </span>{" "}
              cooking,{" "}
              <span className="font-semibold tabular">{d.kitchen.ready}</span>{" "}
              ready
            </span>
          </div>
        </NowCard>

        <NowCard icon={Wallet} title="Cash drawer" href="/expenses">
          {d.drawer_expected !== null ? (
            <>
              <p className="text-3xl font-bold">{money(d.drawer_expected)}</p>
              <p className="text-sm text-ink-soft">
                should be in the drawer · open since{" "}
                {timeOf(d.drawer_open_since!)}
              </p>
            </>
          ) : (
            <p className="text-sm font-medium text-amber-600">
              Closed. Nobody has opened a shift.
            </p>
          )}
          {d.payments.length > 0 && (
            <ul className="mt-3 space-y-0.5 text-sm">
              {d.payments.map((p) => (
                <li key={p.key} className="flex justify-between">
                  <span className="text-ink-soft">{p.label} today</span>
                  <span className="tabular">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </NowCard>

        <NowCard icon={PackageX} title="Running low" href="/inventory">
          {d.low_stock_count === 0 ? (
            <p className="text-sm text-ok">
              Nothing is below its reorder level.
            </p>
          ) : (
            <>
              <p className="text-3xl font-bold tabular">{d.low_stock_count}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {d.low_stock.slice(0, 5).map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span className="truncate">{i.name}</span>
                    <span className="shrink-0 font-medium text-amber-600 tabular">
                      {i.on_hand}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </NowCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="mb-3 font-semibold">Today by section</h2>
          {d.sections.length === 0 ? (
            <p className="text-sm text-ink-soft">No bills paid yet today.</p>
          ) : (
            <ul className="space-y-2.5">
              {d.sections.map((s) => {
                const max = Math.max(...d.sections.map((x) => x.amount));
                return (
                  <li key={s.key} className="text-sm">
                    <div className="flex justify-between">
                      <span>{s.label}</span>
                      <span className="tabular">{money(s.amount)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-ground">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${max ? (s.amount / max) * 100 : 0}%`,
                          background: SERIES.bills,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <h2 className="mb-2 font-semibold">Latest bills</h2>
          {d.recent.length === 0 ? (
            <p className="text-sm text-ink-soft">No bills paid yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {d.recent.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/pos/${b.id}`}
                    className="flex items-center gap-3 py-2 hover:bg-ground"
                  >
                    <span className="w-12 shrink-0 text-ink-soft tabular">
                      {timeOf(b.closed_at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{b.label}</span>
                    <span className="hidden text-xs text-ink-soft sm:inline">
                      {b.methods.map((m) => METHOD_LABEL[m]).join(" + ")}
                    </span>
                    <span className="font-semibold tabular">
                      {money(b.total)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "bad";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd
        className={clsx(
          "mt-1 text-xl font-bold tabular",
          tone === "bad" && "text-danger",
        )}
      >
        {value}
      </dd>
      {hint && <dd className="mt-1 text-xs text-ink-soft">{hint}</dd>}
    </div>
  );
}

function NowCard({
  icon: Icon,
  title,
  href,
  children,
}: {
  icon: typeof Wallet;
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="p-5">
      <Link
        href={href}
        className="mb-2 flex items-center gap-2 text-sm font-semibold hover:underline"
      >
        <Icon className="size-4 text-ink-soft" aria-hidden /> {title}
      </Link>
      {children}
    </Panel>
  );
}

function Small({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <li className="flex justify-between">
      <span className="text-ink-soft">{label}</span>
      <span className={clsx("font-medium tabular", warn && "text-amber-600")}>
        {value}
      </span>
    </li>
  );
}
