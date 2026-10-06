"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
  type RectangleProps,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

import { useMoney } from "@/lib/money";
import type { ReportDay } from "@/lib/types";

/**
 * Chart colours, checked with the colour-blind validator (all pairs pass;
 * amber is under 3:1 on white, so every chart has a legend and tooltips).
 */
export const SERIES = {
  bills: "#1f8a62",
  rooms: "#c8891e",
  profit: "#2a78d6",
  past: "#c5cbc8", // yesterday: de-emphasised context, not a competing series
};
const GRID = "#e6eae8";
const SURFACE = "#ffffff";
const INK_SOFT = "#5b6662";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const axisTick = { fill: INK_SOFT, fontSize: 12 };

export function Legend({
  items,
}: {
  items: { label: string; color: string; line?: boolean }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.line ? (
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ background: i.color }}
              aria-hidden
            />
          ) : (
            <span
              className="size-2.5 rounded-sm"
              style={{ background: i.color }}
              aria-hidden
            />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function TipCard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color: string; line?: boolean }[];
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-ink-soft">
          {r.line ? (
            <span
              className="h-0.5 w-3 rounded-full"
              style={{ background: r.color }}
              aria-hidden
            />
          ) : (
            <span
              className="size-2 rounded-sm"
              style={{ background: r.color }}
              aria-hidden
            />
          )}
          <span className="flex-1">{r.label}</span>
          <span className="font-semibold text-ink tabular">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

const hourLabel = (h: number) =>
  h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;

/** Sales per hour today, with yesterday in grey behind it for comparison. */
export function HourlyChart({
  data,
}: {
  data: { hour: number; today: number | null; yesterday: number }[];
}) {
  const money = useMoney();
  // Start at the first hour with any sales (either day), so the chart isn't half empty.
  const first = Math.max(
    0,
    Math.min(
      ...data
        .filter((d) => (d.today ?? 0) > 0 || d.yesterday > 0)
        .map((d) => d.hour),
      10,
    ) - 1,
  );
  const rows = data
    .slice(first)
    .map((d) => ({ ...d, label: hourLabel(d.hour) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={rows}
        barGap={2}
        margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={12}
        />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => compact.format(v)}
        />
        <Tooltip
          cursor={{ fill: "#f2f4f3" }}
          content={(p: TooltipProps<number, string>) =>
            p.active && p.payload?.length ? (
              <TipCard
                title={String(p.label)}
                rows={[
                  ...(p.payload[0].payload.today !== null
                    ? [
                        {
                          label: "Today",
                          value: money(p.payload[0].payload.today),
                          color: SERIES.bills,
                        },
                      ]
                    : []),
                  {
                    label: "Yesterday",
                    value: money(p.payload[0].payload.yesterday),
                    color: SERIES.past,
                  },
                ]}
              />
            ) : null
          }
        />
        <Bar
          dataKey="yesterday"
          fill={SERIES.past}
          radius={[4, 4, 0, 0]}
          maxBarSize={14}
          isAnimationActive={false}
        />
        <Bar
          dataKey="today"
          fill={SERIES.bills}
          radius={[4, 4, 0, 0]}
          maxBarSize={14}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Last 30 days: bills and rooms stacked, with profit as a line when allowed. */
export function TrendChart({ data }: { data: ReportDay[] }) {
  const money = useMoney();
  const showProfit = data.some((d) => d.profit !== null);
  const rows = data.map((d) => ({
    ...d,
    label: new Date(d.day + "T00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    }),
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart
        data={rows}
        margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => compact.format(v)}
        />
        <Tooltip
          cursor={{ fill: "#f2f4f3" }}
          content={(p: TooltipProps<number, string>) => {
            if (!p.active || !p.payload?.length) return null;
            const d = p.payload[0].payload as ReportDay & { label: string };
            return (
              <TipCard
                title={new Date(d.day + "T00:00").toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
                rows={[
                  {
                    label: "Bills",
                    value: money(d.sales),
                    color: SERIES.bills,
                  },
                  {
                    label: "Rooms",
                    value: money(d.rooms),
                    color: SERIES.rooms,
                  },
                  ...(d.expenses !== null
                    ? [
                        {
                          label: "Expenses",
                          value: money(d.expenses),
                          color: "#9aa3a0",
                        },
                      ]
                    : []),
                  ...(d.profit !== null
                    ? [
                        {
                          label: "Profit",
                          value: money(d.profit),
                          color: SERIES.profit,
                          line: true,
                        },
                      ]
                    : []),
                ]}
              />
            );
          }}
        />
        {/* The surface-coloured stroke is the 2px gap between stacked parts and neighbouring bars. */}
        <Bar
          dataKey="sales"
          stackId="in"
          fill={SERIES.bills}
          stroke={SURFACE}
          strokeWidth={1}
          maxBarSize={24}
          isAnimationActive={false}
          // Round the top only when no room income sits on top of it.
          shape={(props: unknown) => {
            const p = props as RectangleProps & { payload?: { rooms: number } };
            return (
              <Rectangle {...p} radius={p.payload?.rooms ? 0 : [4, 4, 0, 0]} />
            );
          }}
        />
        <Bar
          dataKey="rooms"
          stackId="in"
          fill={SERIES.rooms}
          stroke={SURFACE}
          strokeWidth={1}
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
        {showProfit && (
          <Line
            dataKey="profit"
            stroke={SERIES.profit}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2 }}
            strokeLinejoin="round"
            strokeLinecap="round"
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
