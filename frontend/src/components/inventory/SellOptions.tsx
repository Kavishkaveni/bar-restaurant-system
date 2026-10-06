"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { QtyInput } from "@/components/QtyInput";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import type { Item, SellOption } from "@/lib/types";
import { BASE_LABEL, round3 } from "@/lib/units";

/** Other ways to sell an item, e.g. a single cigarette from a pack of 20. */
export function SellOptions({ item }: { item: Item }) {
  const { can } = useAuth();
  const money = useMoney();
  const qc = useQueryClient();
  const manage = can("catalogue.manage");
  const options = useQuery({
    queryKey: ["items", "options", item.id],
    queryFn: () => api<SellOption[]>(`/items/${item.id}/options`),
  });
  const [editing, setEditing] = useState<SellOption | "new" | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["items", "options", item.id] });
    qc.invalidateQueries({ queryKey: ["pos-menu"] });
  };
  const del = useMutation({
    mutationFn: (id: number) =>
      api(`/items/${item.id}/options/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const takes = (q: number) => {
    if (q === item.unit_size) return `1 ${item.stock_unit}`;
    return `${round3(q)} ${BASE_LABEL[item.base_unit]}`;
  };

  return (
    <section>
      <h3 className="font-semibold">How it&apos;s sold</h3>
      <p className="mb-2 text-sm text-ink-soft">
        Each line is a button on the POS. Stock goes down by the amount shown.
      </p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className="flex-1 font-medium">1 {item.stock_unit}</span>
          {item.selling_price != null ? (
            <span className="tabular">{money(item.selling_price)}</span>
          ) : (
            <span className="text-ink-soft">
              Not sold whole (no selling price)
            </span>
          )}
        </li>
        {options.data?.map((o) =>
          editing !== "new" && editing?.id === o.id ? (
            <li key={o.id} className="p-4">
              <OptionForm
                item={item}
                option={o}
                onDone={() => {
                  setEditing(null);
                  refresh();
                }}
              />
            </li>
          ) : (
            <li
              key={o.id}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{o.name}</span>
                <span className="block text-xs text-ink-soft">
                  takes {takes(o.deduct_qty)} from stock
                </span>
              </span>
              <span className="tabular">{money(o.price)}</span>
              {manage && (
                <>
                  <Button
                    variant="ghost"
                    aria-label={`Edit ${o.name}`}
                    onClick={() => setEditing(o)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${o.name}`}
                    busy={del.isPending && del.variables === o.id}
                    onClick={() => del.mutate(o.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ),
        )}
        {editing === "new" && (
          <li className="p-4">
            <OptionForm
              item={item}
              option={null}
              onDone={() => {
                setEditing(null);
                refresh();
              }}
            />
          </li>
        )}
      </ul>
      {manage && editing === null && (
        <Button
          variant="secondary"
          className="mt-2"
          onClick={() => setEditing("new")}
        >
          <Plus className="size-4" aria-hidden /> Add a way to sell
        </Button>
      )}
    </section>
  );
}

function OptionForm({
  item,
  option,
  onDone,
}: {
  item: Item;
  option: SellOption | null;
  onDone: () => void;
}) {
  const suggested =
    item.base_unit === "piece" ? 1 : item.base_unit === "ml" ? 60 : 100;
  const [name, setName] = useState(
    option?.name ?? (item.base_unit === "piece" ? "Single" : ""),
  );
  const [qty, setQty] = useState(option?.deduct_qty ?? suggested);
  const [price, setPrice] = useState(option ? String(option.price) : "");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body = { name, deduct_qty: qty, price: Number(price) || 0 };
      return option
        ? api(`/items/${item.id}/options/${option.id}`, {
            method: "PUT",
            json: body,
          })
        : api(`/items/${item.id}/options`, { method: "POST", json: body });
    },
    onSuccess: onDone,
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        if (!(qty > 0))
          return setError("Enter how much each sale takes from stock.");
        save.mutate();
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name on the POS button">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Single, Half bottle"
              required
              maxLength={60}
            />
          )}
        </Field>
        <Field label="Price">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              className="tabular"
            />
          )}
        </Field>
      </div>
      <QtyInput
        item={item}
        value={qty}
        onChange={setQty}
        label="Each sale takes from stock"
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" busy={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
