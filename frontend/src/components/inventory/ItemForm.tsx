"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { Category, Item, ItemKind, Module, Supplier } from "@/lib/types";
import { PRESETS, type PresetKey, presetOf } from "@/lib/units";

const MODULE_LABEL: Record<Module, string> = {
  bar: "Bar",
  sundry: "Sundries",
  food: "Kitchen",
  other: "Other",
};

const SINGLE_UNIT_SUGGESTIONS = [
  "bottle",
  "can",
  "piece",
  "packet",
  "egg",
  "cylinder",
];

export function ItemForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Item | "new" | null;
  onClose: () => void;
  /** Called with the saved item, e.g. to open a new dish so its recipe can be added. */
  onSaved?: (item: Item, isNew: boolean) => void;
}) {
  const qc = useQueryClient();
  const existing = editing === "new" ? null : editing;
  const locked = existing?.has_movements ?? false;

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/categories"),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api<Supplier[]>("/suppliers"),
  });

  const [kind, setKind] = useState<ItemKind>(existing?.kind ?? "final_product");
  const isDish = kind === "build_assembly";
  const [name, setName] = useState(existing?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(
    existing?.category.id ?? "",
  );
  const [preset, setPreset] = useState<PresetKey>(
    existing ? presetOf(existing) : "bottle",
  );
  const [size, setSize] = useState<string>(
    existing ? String(existing.unit_size) : "750",
  );
  const [singleUnit, setSingleUnit] = useState(
    existing && presetOf(existing) === "single"
      ? existing.stock_unit
      : "bottle",
  );
  const [costPrice, setCostPrice] = useState(
    existing ? String(existing.cost_price) : "",
  );
  const [sellingPrice, setSellingPrice] = useState(
    existing?.selling_price != null ? String(existing.selling_price) : "",
  );
  const [reorder, setReorder] = useState(
    existing ? String(existing.reorder_level) : "",
  );
  const [trackStock, setTrackStock] = useState(existing?.track_stock ?? true);
  const [supplierId, setSupplierId] = useState<number | "">(
    existing?.supplier?.id ?? "",
  );
  const [sku, setSku] = useState(existing?.sku ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [error, setError] = useState("");

  const p = PRESETS.find((x) => x.key === preset)!;
  const stockUnit = p.fixedUnit ?? (singleUnit.trim().toLowerCase() || "piece");
  const unitSize = p.fixedSize ?? Number(size);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        category_id: categoryId,
        kind,
        base_unit: isDish ? "piece" : p.base_unit,
        unit_size: isDish ? 1 : unitSize,
        stock_unit: isDish ? "plate" : stockUnit,
        cost_price: Number(costPrice) || 0,
        selling_price: sellingPrice === "" ? null : Number(sellingPrice),
        reorder_level: Number(reorder) || 0,
        track_stock: trackStock,
        supplier_id: supplierId === "" ? null : supplierId,
        sku,
        notes,
      };
      return existing
        ? api<Item>(`/items/${existing.id}`, { method: "PUT", json: body })
        : api<Item>("/items", { method: "POST", json: body });
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["pos-menu"] });
      onClose();
      onSaved?.(item, !existing);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!categoryId) return setError("Choose a category.");
    if (isDish && sellingPrice === "") return setError("Enter the menu price.");
    if (!isDish && !p.fixedSize && !(unitSize >= 1))
      return setError(`${p.sizeLabel} must be at least 1.`);
    if (preset === "pack" && !Number.isInteger(unitSize))
      return setError("Pieces per pack must be a whole number.");
    save.mutate();
  }

  const noCategories = categories.data && categories.data.length === 0;

  return (
    <Modal
      open={editing !== null}
      title={
        existing ? `Edit ${existing.name}` : isDish ? "Add dish" : "Add item"
      }
      onClose={onClose}
      size="lg"
    >
      {noCategories ? (
        <div className="space-y-3 text-sm">
          <p>
            Add a category first, for example Whisky, Beer, Soft drinks,
            Cigarettes or Rice.
          </p>
          <p className="text-ink-soft">
            Open the Categories tab, add one, then come back here.
          </p>
          <Button onClick={onClose}>OK</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label="What is it?"
          >
            {(
              [
                {
                  k: "final_product",
                  title: "Stocked item",
                  hint: "Bought and counted: liquor, drinks, cigarettes, ingredients.",
                },
                {
                  k: "build_assembly",
                  title: "Dish made to order",
                  hint: "Sold at a menu price; its recipe takes ingredients from stock.",
                },
              ] as { k: ItemKind; title: string; hint: string }[]
            ).map((o) => (
              <label
                key={o.k}
                className={`flex gap-3 rounded-lg border p-3 text-sm ${kind === o.k ? "border-amber-500 bg-amber-100/40" : "border-line"} ${
                  locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  className="mt-0.5 accent-amber-500"
                  checked={kind === o.k}
                  disabled={locked}
                  onChange={() => setKind(o.k)}
                />
                <span>
                  <span className="block font-medium">{o.title}</span>
                  <span className="block text-ink-soft">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    isDish
                      ? "e.g. Chicken Fried Rice"
                      : "e.g. Rockland Arrack 750ml"
                  }
                  required
                />
              )}
            </Field>
            <Field label="Category">
              {(id) => (
                <Select
                  id={id}
                  value={categoryId}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                  required
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {(["bar", "sundry", "food", "other"] as Module[]).map((m) => {
                    const list =
                      categories.data?.filter((c) => c.module === m) ?? [];
                    if (!list.length) return null;
                    return (
                      <optgroup key={m} label={MODULE_LABEL[m]}>
                        {list.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </Select>
              )}
            </Field>
          </div>

          {isDish ? (
            <div className="max-w-xs">
              <Field
                label="Menu price"
                hint="After saving, add the recipe so each sale takes its ingredients."
              >
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    step="0.01"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    required
                    className="tabular"
                  />
                )}
              </Field>
            </div>
          ) : (
            <>
              <fieldset className="space-y-3 rounded-xl border border-line p-4">
                <legend className="px-1 text-sm font-semibold">
                  How is it counted?
                </legend>
                {locked && (
                  <p className="flex items-start gap-2 text-sm text-ink-soft">
                    <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Stock is already recorded for this item, so its unit
                    can&apos;t change. Create a new item if it&apos;s wrong.
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {PRESETS.map((x) => (
                    <label
                      key={x.key}
                      className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${
                        preset === x.key
                          ? "border-amber-500 bg-amber-100/40"
                          : "border-line"
                      } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <input
                        type="radio"
                        name="preset"
                        className="mt-0.5 accent-amber-500"
                        checked={preset === x.key}
                        disabled={locked}
                        onChange={() => {
                          setPreset(x.key);
                          if (x.defaultSize) setSize(String(x.defaultSize));
                        }}
                      />
                      <span>
                        <span className="block font-medium">{x.label}</span>
                        <span className="block text-ink-soft">{x.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {!p.fixedSize && (
                  <div className="max-w-xs">
                    <Field label={p.sizeLabel!}>
                      {(id) => (
                        <Input
                          id={id}
                          type="number"
                          min={1}
                          step={preset === "pack" ? 1 : "any"}
                          value={size}
                          onChange={(e) => setSize(e.target.value)}
                          disabled={locked}
                          required
                          className="tabular"
                        />
                      )}
                    </Field>
                  </div>
                )}
                {preset === "single" && (
                  <div className="max-w-xs">
                    <Field
                      label="Each one is a"
                      hint="Used in labels, e.g. 24 cans."
                    >
                      {(id) => (
                        <>
                          <Input
                            id={id}
                            list={`${id}-units`}
                            value={singleUnit}
                            onChange={(e) => setSingleUnit(e.target.value)}
                            maxLength={20}
                            required
                          />
                          <datalist id={`${id}-units`}>
                            {SINGLE_UNIT_SUGGESTIONS.map((u) => (
                              <option key={u} value={u} />
                            ))}
                          </datalist>
                        </>
                      )}
                    </Field>
                  </div>
                )}
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label={`Cost price per ${stockUnit}`}
                  hint="What you pay the supplier. Purchases update it."
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      step="0.01"
                      value={costPrice}
                      onChange={(e) => setCostPrice(e.target.value)}
                      className="tabular"
                    />
                  )}
                </Field>
                <Field
                  label={`Selling price per ${stockUnit}`}
                  hint="Leave empty for ingredients you don't sell whole."
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      step="0.01"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      className="tabular"
                    />
                  )}
                </Field>
                <Field
                  label={`Reorder when below (${stockUnit})`}
                  hint="Shows a low-stock warning."
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      step="any"
                      value={reorder}
                      onChange={(e) => setReorder(e.target.value)}
                      className="tabular"
                    />
                  )}
                </Field>
              </div>

              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-amber-500"
                  checked={trackStock}
                  onChange={(e) => setTrackStock(e.target.checked)}
                />
                <span>
                  <span className="block font-medium">
                    Track stock for this item
                  </span>
                  <span className="block text-ink-soft">
                    Turn off for cheap things you don&apos;t count, like salt or
                    chilli powder. They&apos;re still bought and costed.
                  </span>
                </span>
              </label>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {!isDish && (
              <Field label="Usual supplier (optional)">
                {(id) => (
                  <Select
                    id={id}
                    value={supplierId}
                    onChange={(e) =>
                      setSupplierId(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  >
                    <option value="">None</option>
                    {suppliers.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Code or barcode (optional)">
              {(id) => (
                <Input
                  id={id}
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  maxLength={60}
                />
              )}
            </Field>
          </div>
          <Field label="Notes (optional)">
            {(id) => (
              <Textarea
                id={id}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>

          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" busy={save.isPending}>
              {existing ? "Save changes" : isDish ? "Add dish" : "Add item"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
