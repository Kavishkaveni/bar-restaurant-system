"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import { PaymentBadge } from "@/components/purchases/PaymentBadge";
import { PurchaseDetail } from "@/components/purchases/PurchaseDetail";
import { PurchaseForm } from "@/components/purchases/PurchaseForm";
import { SuppliersTab } from "@/components/purchases/SuppliersTab";
import {
  Button,
  ErrorText,
  PageHeader,
  Panel,
  Select,
  Spinner,
  Tabs,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, useMoney } from "@/lib/money";
import type { Page, Purchase, Supplier } from "@/lib/types";

export default function PurchasesPage() {
  const [tab, setTab] = useState<"purchases" | "suppliers">("purchases");
  return (
    <Guard anyOf={["purchasing.manage"]}>
      <PageHeader
        title="Purchases"
        description="Record what you buy. Stock goes up as soon as a purchase is saved."
      />
      <Tabs
        tabs={[
          { key: "purchases", label: "Purchases" },
          { key: "suppliers", label: "Suppliers" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "purchases" ? <PurchasesTab /> : <SuppliersTab />}
    </Guard>
  );
}

function PurchasesTab() {
  const money = useMoney();
  const [page, setPage] = useState(1);
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (supplierId) params.set("supplier_id", String(supplierId));
  if (unpaidOnly) params.set("unpaid_only", "true");

  const purchases = useQuery({
    queryKey: ["purchases", params.toString()],
    queryFn: () => api<Page<Purchase>>(`/purchases?${params}`),
    placeholderData: keepPreviousData,
  });
  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api<Supplier[]>("/suppliers"),
  });

  const data = purchases.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const open = data?.items.find((x) => x.id === openId) ?? null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-56">
          <Select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value ? Number(e.target.value) : "");
              setPage(1);
            }}
            aria-label="Supplier"
          >
            <option value="">All suppliers</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            className="size-4 accent-amber-500"
            checked={unpaidOnly}
            onChange={(e) => {
              setUnpaidOnly(e.target.checked);
              setPage(1);
            }}
          />
          Not fully paid
        </label>
        <Button onClick={() => setCreating(true)} className="sm:ml-auto">
          <Plus className="size-4" aria-hidden /> New purchase
        </Button>
      </div>

      {purchases.isLoading ? (
        <Spinner />
      ) : purchases.error ? (
        <ErrorText>{(purchases.error as Error).message}</ErrorText>
      ) : !data?.items.length ? (
        <Panel className="px-6 py-12 text-center">
          <p className="font-semibold">
            {supplierId || unpaidOnly
              ? "No purchases match these filters"
              : "No purchases yet"}
          </p>
          {!supplierId && !unpaidOnly && (
            <p className="mt-1 text-sm text-ink-soft">
              When stock arrives, record the supplier&apos;s invoice here.
            </p>
          )}
        </Panel>
      ) : (
        <>
          <Panel className="overflow-hidden">
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b border-line bg-ground text-left text-ink-soft">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Paid</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setOpenId(p.id)}
                    className={`cursor-pointer hover:bg-ground ${p.status === "cancelled" ? "opacity-60" : ""}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap tabular">
                      {formatDate(p.invoice_date)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="text-left font-medium hover:underline"
                        onClick={() => setOpenId(p.id)}
                      >
                        {p.supplier.name}
                      </button>
                      <div className="text-ink-soft">
                        {p.lines.length} item{p.lines.length === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {p.invoice_no || "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {money(p.total)}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {money(p.amount_paid)}
                    </td>
                    <td className="px-4 py-3">
                      <PaymentBadge purchase={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {data.items.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setOpenId(p.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left ${p.status === "cancelled" ? "opacity-60" : ""}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {p.supplier.name}
                      </span>
                      <span className="block text-sm text-ink-soft">
                        {formatDate(p.invoice_date)}
                        {p.invoice_no && ` · ${p.invoice_no}`}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold tabular">
                        {money(p.total)}
                      </span>
                      <PaymentBadge purchase={p} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-ink-soft tabular">
                {data.total} purchases · page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((x) => x - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  disabled={page >= pages}
                  onClick={() => setPage((x) => x + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <PurchaseForm open={creating} onClose={() => setCreating(false)} />
      <PurchaseDetail purchase={open} onClose={() => setOpenId(null)} />
    </>
  );
}
