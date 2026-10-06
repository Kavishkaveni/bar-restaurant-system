"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Plus, Search, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import { CategoriesTab, MODULES } from "@/components/inventory/CategoriesTab";
import { ItemDetail } from "@/components/inventory/ItemDetail";
import { ItemForm } from "@/components/inventory/ItemForm";
import { OpenBottlesTab } from "@/components/inventory/OpenBottlesTab";
import {
  Badge,
  Button,
  ErrorText,
  Input,
  PageHeader,
  Panel,
  Select,
  Spinner,
  Tabs,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import type { Category, Item, Module } from "@/lib/types";

const VIEWERS = [
  "catalogue.manage",
  "stock.count",
  "stock.wastage",
  "bar.open_bottle",
  "purchasing.manage",
];

export default function InventoryPage() {
  const [tab, setTab] = useState<"items" | "bottles" | "categories">("items");
  return (
    <Guard anyOf={VIEWERS}>
      <PageHeader
        title="Inventory"
        description="Everything you buy and sell, and how much is in stock right now."
      />
      <Tabs
        tabs={[
          { key: "items", label: "Items and stock" },
          { key: "bottles", label: "Open bottles" },
          { key: "categories", label: "Categories" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "items" && <ItemsTab />}
      {tab === "bottles" && <OpenBottlesTab />}
      {tab === "categories" && <CategoriesTab />}
    </Guard>
  );
}

function ItemsTab() {
  const { can } = useAuth();
  const money = useMoney();
  const [q, setQ] = useState("");
  const [module, setModule] = useState<Module | "">("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [lowOnly, setLowOnly] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);

  const items = useQuery({
    queryKey: ["items", "list"],
    queryFn: () => api<Item[]>("/items"),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/categories"),
  });

  const term = q.trim().toLowerCase();
  const all = items.data ?? [];
  const list = all.filter(
    (i) =>
      (!term ||
        i.name.toLowerCase().includes(term) ||
        i.sku.toLowerCase().includes(term)) &&
      (!module || i.category.module === module) &&
      (!categoryId || i.category.id === categoryId) &&
      (!lowOnly || i.is_low),
  );
  const lowCount = all.filter((i) => i.is_low).length;
  const totalValue = list.reduce((s, i) => s + i.stock_value, 0);
  const open = all.find((i) => i.id === openId) ?? null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft"
            aria-hidden
          />
          <Input
            placeholder="Search items"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            aria-label="Search items"
          />
        </div>
        <div className="w-full sm:w-44">
          <Select
            value={module}
            onChange={(e) => {
              setModule(e.target.value as Module | "");
              setCategoryId("");
            }}
            aria-label="Section"
          >
            <option value="">All sections</option>
            {MODULES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={categoryId}
            onChange={(e) =>
              setCategoryId(e.target.value ? Number(e.target.value) : "")
            }
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.data
              ?.filter((c) => !module || c.module === module)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </div>
        <button
          onClick={() => setLowOnly((v) => !v)}
          aria-pressed={lowOnly}
          className={clsx(
            "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
            lowOnly
              ? "border-amber-500 bg-amber-100 text-amber-600"
              : "border-line bg-surface text-ink-soft hover:text-ink",
          )}
        >
          <TriangleAlert className="size-4" aria-hidden /> Low stock
          {lowCount > 0 && <span className="tabular">({lowCount})</span>}
        </button>
        {can("catalogue.manage") && (
          <Button onClick={() => setEditing("new")} className="sm:ml-auto">
            <Plus className="size-4" aria-hidden /> Add item
          </Button>
        )}
      </div>

      {items.isLoading ? (
        <Spinner />
      ) : items.error ? (
        <ErrorText>{(items.error as Error).message}</ErrorText>
      ) : all.length === 0 ? (
        <Panel className="px-6 py-12 text-center">
          <p className="font-semibold">No items yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
            Add categories first, then add each liquor brand, soft drink,
            cigarette and ingredient you stock.
          </p>
        </Panel>
      ) : list.length === 0 ? (
        <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
          No items match these filters.
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <table className="hidden w-full text-sm md:table">
            <thead className="border-b border-line bg-ground text-left text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">In stock</th>
                <th className="px-4 py-3 text-right font-medium">
                  Selling price
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  Stock value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => setOpenId(i.id)}
                  className="cursor-pointer hover:bg-ground"
                >
                  <td className="px-4 py-3">
                    <button
                      className="text-left font-medium hover:underline"
                      onClick={() => setOpenId(i.id)}
                    >
                      {i.name}
                    </button>
                    <div className="text-ink-soft">{i.category.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        "tabular",
                        i.is_low && "font-semibold text-amber-600",
                      )}
                    >
                      {i.on_hand_display}
                    </span>{" "}
                    {i.is_low && <Badge tone="warn">Low</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right tabular">
                    {i.selling_price != null ? money(i.selling_price) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular">
                    {i.track_stock ? money(i.stock_value) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line bg-ground">
              <tr>
                <td className="px-4 py-3 text-ink-soft" colSpan={3}>
                  {list.length} item{list.length === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular">
                  {money(totalValue)}
                </td>
              </tr>
            </tfoot>
          </table>

          <ul className="divide-y divide-line md:hidden">
            {list.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => setOpenId(i.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {i.category.name}
                    </span>
                  </span>
                  <span className="text-right">
                    <span
                      className={clsx(
                        "block text-sm tabular",
                        i.is_low ? "font-semibold text-amber-600" : "text-ink",
                      )}
                    >
                      {i.on_hand_display}
                    </span>
                    {i.is_low && <Badge tone="warn">Low</Badge>}
                  </span>
                </button>
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 text-sm">
              <span className="text-ink-soft">Stock value</span>
              <span className="font-semibold tabular">{money(totalValue)}</span>
            </li>
          </ul>
        </Panel>
      )}

      <ItemDetail
        item={open}
        onClose={() => setOpenId(null)}
        onEdit={(it) => {
          setOpenId(null);
          setEditing(it);
        }}
      />
      <ItemForm
        key={editing === "new" ? "new" : (editing?.id ?? "none")}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(it, isNew) => {
          if (isNew && it.kind === "build_assembly") setOpenId(it.id);
        }}
      />
    </>
  );
}
