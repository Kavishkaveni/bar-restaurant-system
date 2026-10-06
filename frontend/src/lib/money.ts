"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { BusinessSettings } from "./types";

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api<BusinessSettings>("/settings"), staleTime: 5 * 60_000 });
}

const fmt = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Returns a formatter like money(1500) → "Rs. 1,500.00", using the business currency. */
export function useMoney(): (n: number | null | undefined) => string {
  const { data } = useSettings();
  const symbol = data?.currency_symbol ?? "Rs.";
  return (n) => (n === null || n === undefined ? "—" : `${symbol} ${fmt.format(n)}`);
}

export function formatDate(iso: string): string {
  // Dates without time (YYYY-MM-DD) are local calendar days.
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
