"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input, Modal } from "@/components/ui";
import { useMoney } from "@/lib/money";
import type { Menu, MenuItem, MenuOption } from "@/lib/types";

/** Big buttons for busy hands: pick a category, tap an item. Items with
 *  more than one way to sell (pack or single) ask which one. */
export function ItemPicker({ menu, onPick, busy }: { menu: Menu; onPick: (item: MenuItem, option: MenuOption) => void; busy: boolean }) {
  const money = useMoney();
  const [category, setCategory] = useState<number | "all">("all");
  const [q, setQ] = useState("");
  const [choosing, setChoosing] = useState<MenuItem | null>(null);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return menu.items.filter(
      (i) => (category === "all" || i.category_id === category) && (!term || i.name.toLowerCase().includes(term)),
    );
  }, [menu.items, category, q]);

  function tap(item: MenuItem) {
    if (item.options.length === 1) onPick(item, item.options[0]);
    else setChoosing(item);
  }

  if (!menu.items.length) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-soft">
        Nothing to sell yet. Give items a selling price in Inventory, or add selling options like single cigarettes.
      </p>
    );
  }

  return (
    <div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
        <Input placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" aria-label="Search items" />
      </div>
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categories">
        {[{ id: "all" as const, name: "All" }, ...menu.categories].map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
            className={clsx(
              "h-10 shrink-0 rounded-full px-4 text-sm font-semibold",
              category === c.id ? "bg-bottle-900 text-white" : "bg-surface text-ink ring-1 ring-line hover:bg-ground",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-soft">No items match.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
          {items.map((i) => (
            <li key={i.id}>
              <button
                onClick={() => tap(i)}
                disabled={busy}
                className={clsx(
                  "flex h-24 w-full flex-col justify-between rounded-xl border bg-surface p-3 text-left transition-colors active:bg-amber-100 disabled:opacity-60",
                  i.out_of_stock ? "border-danger/40" : "border-line hover:border-amber-500",
                )}
              >
                <span className="line-clamp-2 text-sm leading-snug font-semibold">{i.name}</span>
                <span className="flex items-end justify-between gap-1">
                  <span className="text-sm tabular">{i.options.length > 1 ? `from ${money(Math.min(...i.options.map((o) => o.price)))}` : money(i.options[0].price)}</span>
                  {i.out_of_stock && <span className="text-[11px] font-semibold text-danger">Out</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={choosing !== null} title={choosing?.name ?? ""} onClose={() => setChoosing(null)}>
        <div className="grid gap-2 sm:grid-cols-2">
          {choosing?.options.map((o) => (
            <button
              key={o.id ?? "whole"}
              onClick={() => {
                onPick(choosing, o);
                setChoosing(null);
              }}
              className="flex h-20 flex-col justify-center rounded-xl border-2 border-line px-4 text-left hover:border-amber-500 active:bg-amber-100"
            >
              <span className="font-semibold">{o.name}</span>
              <span className="text-sm text-ink-soft tabular">{money(o.price)}</span>
            </button>
          ))}
        </div>
        {choosing?.track_stock && <p className="mt-3 text-sm text-ink-soft">In stock: {choosing.on_hand_display}</p>}
      </Modal>
    </div>
  );
}
