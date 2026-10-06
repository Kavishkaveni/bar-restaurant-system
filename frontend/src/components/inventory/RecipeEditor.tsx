"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChefHat, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import type { Item, Recipe } from "@/lib/types";
import { BASE_LABEL } from "@/lib/units";

type Draft = { key: number; componentId: number | ""; qty: string };
let nextKey = 1;

function unitCost(i: Item): number {
  return i.track_stock && i.avg_cost > 0
    ? i.avg_cost
    : i.cost_price / i.unit_size;
}

/**
 * For a dish: what one portion uses. For a stocked item made in-house (e.g.
 * Spice Mix): what one batch uses and how much it makes.
 */
export function RecipeEditor({ item }: { item: Item }) {
  const { can } = useAuth();
  const money = useMoney();
  const manage = can("catalogue.manage");
  const isDish = item.kind === "build_assembly";
  const recipe = useQuery({
    queryKey: ["items", "recipe", item.id],
    queryFn: () => api<Recipe>(`/items/${item.id}/recipe`),
  });
  const [editing, setEditing] = useState(false);
  const [producing, setProducing] = useState(false);

  if (recipe.isLoading || !recipe.data)
    return <Spinner label="Loading recipe" />;
  const r = recipe.data;
  const hasRecipe = r.lines.length > 0;

  // Stocked items only show this section once they're batch-made, or to managers.
  if (!isDish && !hasRecipe && !(manage && item.track_stock)) return null;

  if (editing)
    return <EditForm item={item} recipe={r} onDone={() => setEditing(false)} />;

  return (
    <section>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {isDish ? "Recipe (per plate)" : "Made in-house"}
          </h3>
          <p className="text-sm text-ink-soft">
            {isDish
              ? "Each plate sold takes these from stock."
              : hasRecipe
                ? `One batch makes ${r.batch_yield_display}. Making a batch uses these.`
                : "For a house blend like Spice Mix: set a batch recipe, then record each batch you make."}
          </p>
        </div>
        {manage && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />{" "}
            {hasRecipe ? "Edit" : isDish ? "Add recipe" : "Set batch recipe"}
          </Button>
        )}
      </div>

      {hasRecipe ? (
        <>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {r.lines.map((l) => (
              <li
                key={l.id}
                className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-2.5 text-sm"
              >
                <span className="font-medium">{l.component.name}</span>
                <span className="text-right tabular">{money(l.cost)}</span>
                <span className="text-xs text-ink-soft">
                  {fmtBase(l.qty, l.component.base_unit)}
                  {!l.component.track_stock && " · not stock-tracked"}
                </span>
                <span className="text-right text-xs text-ink-soft">
                  in stock {l.on_hand_display}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-ground p-4 text-sm sm:grid-cols-4">
            <Stat label="Ingredients" value={money(r.ingredient_cost)} />
            {isDish ? (
              <>
                <Stat
                  label={`Cost with ${r.overhead_percent}% overhead`}
                  value={money(r.total_cost)}
                />
                <Stat
                  label="Profit per plate"
                  value={r.margin != null ? `${money(r.margin)}` : "—"}
                  tone={r.margin != null && r.margin < 0 ? "bad" : "good"}
                  sub={
                    r.margin_percent != null
                      ? `${r.margin_percent}% of price`
                      : undefined
                  }
                />
                <Stat
                  label="Plates possible"
                  value={
                    r.portions_available != null
                      ? String(r.portions_available)
                      : "—"
                  }
                  tone={r.portions_available === 0 ? "bad" : undefined}
                />
              </>
            ) : (
              <Stat
                label={`Cost per batch (${r.batch_yield_display})`}
                value={money(r.total_cost)}
              />
            )}
          </dl>
          {!isDish && manage && (
            <Button className="mt-3" onClick={() => setProducing(true)}>
              <ChefHat className="size-4" aria-hidden /> Record a batch made
            </Button>
          )}
        </>
      ) : (
        isDish && (
          <p className="rounded-xl border border-dashed border-amber-500 bg-amber-100/40 px-4 py-6 text-center text-sm">
            No recipe yet, so selling this dish won&apos;t take any ingredients
            from stock.
          </p>
        )
      )}
      {!isDish && (
        <ProduceDialog
          item={item}
          recipe={r}
          open={producing}
          onClose={() => setProducing(false)}
        />
      )}
    </section>
  );
}

function fmtBase(qty: number, base: "ml" | "g" | "piece"): string {
  const n = Math.round(qty * 1000) / 1000;
  return `${n} ${BASE_LABEL[base]}`;
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd
        className={clsx(
          "font-semibold tabular",
          tone === "bad" && "text-danger",
          tone === "good" && "text-ok",
        )}
      >
        {value}
      </dd>
      {sub && <dd className="text-xs text-ink-soft">{sub}</dd>}
    </div>
  );
}

function EditForm({
  item,
  recipe,
  onDone,
}: {
  item: Item;
  recipe: Recipe;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const money = useMoney();
  const isDish = item.kind === "build_assembly";
  const items = useQuery({
    queryKey: ["items", "list"],
    queryFn: () => api<Item[]>("/items"),
  });
  const [lines, setLines] = useState<Draft[]>(
    recipe.lines.length
      ? recipe.lines.map((l) => ({
          key: nextKey++,
          componentId: l.component.id,
          qty: String(l.qty),
        }))
      : [{ key: nextKey++, componentId: "", qty: "" }],
  );
  const [batchYield, setBatchYield] = useState(
    recipe.batch_yield ? String(recipe.batch_yield) : "",
  );
  const [error, setError] = useState("");

  const choices = (items.data ?? []).filter(
    (i) => i.kind === "final_product" && i.id !== item.id,
  );
  const byId = new Map(choices.map((i) => [i.id, i]));
  const total = lines.reduce((s, l) => {
    const c = l.componentId === "" ? undefined : byId.get(l.componentId);
    return s + (c ? (Number(l.qty) || 0) * unitCost(c) : 0);
  }, 0);

  const save = useMutation({
    mutationFn: () =>
      api<Recipe>(`/items/${item.id}/recipe`, {
        method: "PUT",
        json: {
          lines: lines
            .filter((l) => l.componentId !== "")
            .map((l) => ({ component_id: l.componentId, qty: Number(l.qty) })),
          batch_yield: isDish ? null : Number(batchYield) || null,
        },
      }),
    onSuccess: (r) => {
      qc.setQueryData(["items", "recipe", item.id], r);
      qc.invalidateQueries({ queryKey: ["pos-menu"] });
      onDone();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const filled = lines.filter((l) => l.componentId !== "");
    if (filled.some((l) => !(Number(l.qty) > 0)))
      return setError("Every ingredient needs an amount above 0.");
    if (!isDish && filled.length && !(Number(batchYield) > 0))
      return setError("Say how much one batch makes.");
    save.mutate();
  }

  const update = (key: number, patch: Partial<Draft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-amber-500 p-4"
    >
      <h3 className="font-semibold">
        {isDish ? "Recipe for one plate" : "Batch recipe"}
      </h3>
      {!isDish && (
        <div className="max-w-xs">
          <Field
            label={`One batch makes (${BASE_LABEL[item.base_unit]})`}
            hint={item.base_unit === "g" ? "e.g. 1000 for 1 kg" : undefined}
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="any"
                value={batchYield}
                onChange={(e) => setBatchYield(e.target.value)}
                className="tabular"
              />
            )}
          </Field>
        </div>
      )}
      <ul className="space-y-2">
        {lines.map((l, idx) => {
          const c = l.componentId === "" ? undefined : byId.get(l.componentId);
          return (
            <li
              key={l.key}
              className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2"
            >
              <Field label={`Ingredient ${idx + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    value={l.componentId}
                    onChange={(e) =>
                      update(l.key, { componentId: Number(e.target.value) })
                    }
                  >
                    <option value="" disabled>
                      Choose
                    </option>
                    {choices.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {!i.track_stock ? " (not tracked)" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={c ? `Amount (${BASE_LABEL[c.base_unit]})` : "Amount"}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: e.target.value })}
                    className="tabular"
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove ingredient ${idx + 1}`}
                onClick={() =>
                  setLines((ls) => ls.filter((x) => x.key !== l.key))
                }
              >
                <X className="size-4" aria-hidden />
              </Button>
              {c && Number(l.qty) > 0 && (
                <p className="col-span-3 -mt-1 text-xs text-ink-soft tabular">
                  ≈ {money(Number(l.qty) * unitCost(c))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { key: nextKey++, componentId: "", qty: "" },
            ])
          }
        >
          <Plus className="size-4" aria-hidden /> Add ingredient
        </Button>
        <span className="text-sm">
          Ingredient cost{" "}
          <span className="font-semibold tabular">{money(total)}</span>
          {isDish && item.selling_price != null && (
            <span className="text-ink-soft">
              {" "}
              of {money(item.selling_price)} price
            </span>
          )}
        </span>
      </div>
      <p className="text-xs text-ink-soft">
        Amounts are in grams, ml or pieces of each ingredient. Use a best
        estimate for things like oil; leave out pinches of spice or use a Spice
        Mix batch item.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" busy={save.isPending}>
          Save recipe
        </Button>
      </div>
    </form>
  );
}

function ProduceDialog({
  item,
  recipe,
  open,
  onClose,
}: {
  item: Item;
  recipe: Recipe;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const money = useMoney();
  const [batches, setBatches] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const n = Number(batches) || 0;

  const make = useMutation({
    mutationFn: () =>
      api<Recipe>(`/items/${item.id}/produce`, {
        method: "POST",
        json: { batches: n, note },
      }),
    onSuccess: (r) => {
      qc.setQueryData(["items", "recipe", item.id], r);
      qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  return (
    <Modal open={open} title={`Make ${item.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          make.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Batches made">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0.001}
              step="any"
              value={batches}
              onChange={(e) => setBatches(e.target.value)}
              className="tabular"
            />
          )}
        </Field>
        {n > 0 && (
          <div className="rounded-xl bg-ground p-3 text-sm">
            <p className="font-medium">This takes from stock:</p>
            <ul className="mt-1 space-y-0.5">
              {recipe.lines.map((l) => (
                <li key={l.id} className="flex justify-between">
                  <span>{l.component.name}</span>
                  <span className="tabular">
                    {fmtBase(l.qty * n, l.component.base_unit)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Adds{" "}
              <span className="font-semibold tabular">
                {fmtBase((recipe.batch_yield ?? 0) * n, item.base_unit)}
              </span>{" "}
              of {item.name}, costing{" "}
              <span className="tabular">{money(recipe.total_cost * n)}</span>.
            </p>
          </div>
        )}
        <Field label="Note (optional)">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end">
          <Button type="submit" busy={make.isPending} disabled={!(n > 0)}>
            Record batch
          </Button>
        </div>
      </form>
    </Modal>
  );
}
