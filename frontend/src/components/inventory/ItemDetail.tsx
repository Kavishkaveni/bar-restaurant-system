"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  PackagePlus,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { RecipeEditor } from "@/components/inventory/RecipeEditor";
import { SellOptions } from "@/components/inventory/SellOptions";
import { QtyInput } from "@/components/QtyInput";
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Spinner,
  formatDateTime,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import type { Item, Movement, Page } from "@/lib/types";
import { plural } from "@/lib/units";

const MOVEMENT_LABEL: Record<string, string> = {
  opening: "Opening stock",
  purchase: "Purchase",
  purchase_void: "Purchase cancelled",
  wastage: "Wastage",
  count_adjust: "Count adjustment",
  sale: "Sale",
  void_reversal: "Bill voided",
  open_bottle: "Bottle opened",
  production: "Production",
};

type Action = "opening" | "count" | "wastage" | null;

export function ItemDetail({
  item,
  onClose,
  onEdit,
}: {
  item: Item | null;
  onClose: () => void;
  onEdit: (item: Item) => void;
}) {
  return (
    <Modal
      open={item !== null}
      title={item?.name ?? ""}
      onClose={onClose}
      size="lg"
    >
      {item && (
        <Body
          key={item.id}
          itemId={item.id}
          onClose={onClose}
          onEdit={onEdit}
        />
      )}
    </Modal>
  );
}

function Body({
  itemId,
  onClose,
  onEdit,
}: {
  itemId: number;
  onClose: () => void;
  onEdit: (item: Item) => void;
}) {
  const { can } = useAuth();
  const money = useMoney();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const item = useQuery({
    queryKey: ["items", "one", itemId],
    queryFn: () => api<Item>(`/items/${itemId}`),
  });
  const history = useQuery({
    queryKey: ["items", "movements", itemId, page],
    queryFn: () =>
      api<Page<Movement>>(
        `/items/${itemId}/movements?page=${page}&page_size=15`,
      ),
    placeholderData: keepPreviousData,
  });

  const del = useMutation({
    mutationFn: () => api(`/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
  });

  if (item.isLoading || !item.data) return <Spinner />;
  const it = item.data;
  const perUnit = it.avg_cost * it.unit_size;

  const done = () => {
    setAction(null);
    setPage(1);
    qc.invalidateQueries({ queryKey: ["items"] });
  };

  if (action)
    return (
      <StockAction
        item={it}
        action={action}
        onDone={done}
        onCancel={() => setAction(null)}
      />
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{it.category.name}</Badge>
        {it.is_low && (
          <Badge tone="warn">
            <TriangleAlert className="mr-1 size-3" aria-hidden /> Low stock
          </Badge>
        )}
        {!it.track_stock && <Badge tone="off">Stock not tracked</Badge>}
      </div>

      {it.kind === "build_assembly" ? (
        <dl className="grid grid-cols-2 gap-4 rounded-xl bg-ground p-4">
          <div>
            <dt className="text-xs text-ink-soft">Dish</dt>
            <dd className="text-lg font-bold">Made to order</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Menu price</dt>
            <dd className="text-lg font-bold tabular">
              {money(it.selling_price)}
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="grid grid-cols-2 gap-4 rounded-xl bg-ground p-4 sm:grid-cols-4">
          <div className="col-span-2">
            <dt className="text-xs text-ink-soft">In stock</dt>
            <dd className="text-2xl font-bold tabular">{it.on_hand_display}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Stock value</dt>
            <dd className="font-semibold tabular">{money(it.stock_value)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Reorder below</dt>
            <dd className="font-semibold tabular">
              {it.reorder_level} {plural(it.stock_unit, it.reorder_level)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">
              Average cost / {it.stock_unit}
            </dt>
            <dd className="font-semibold tabular">{money(perUnit)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">
              Last cost / {it.stock_unit}
            </dt>
            <dd className="font-semibold tabular">{money(it.cost_price)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Selling price</dt>
            <dd className="font-semibold tabular">{money(it.selling_price)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Supplier</dt>
            <dd className="font-semibold">{it.supplier?.name ?? "—"}</dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {it.track_stock && !it.has_movements && can("catalogue.manage") && (
          <Button onClick={() => setAction("opening")}>
            <PackagePlus className="size-4" aria-hidden /> Enter opening stock
          </Button>
        )}
        {it.track_stock && can("stock.count") && (
          <Button variant="secondary" onClick={() => setAction("count")}>
            <ClipboardCheck className="size-4" aria-hidden /> Count stock
          </Button>
        )}
        {it.track_stock && can("stock.wastage") && (
          <Button variant="secondary" onClick={() => setAction("wastage")}>
            <TriangleAlert className="size-4" aria-hidden /> Record wastage
          </Button>
        )}
        {can("catalogue.manage") && (
          <>
            <Button variant="secondary" onClick={() => onEdit(it)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                Delete {it.name}?
                <Button
                  variant="danger"
                  busy={del.isPending}
                  onClick={() => del.mutate()}
                >
                  Yes, delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            )}
          </>
        )}
      </div>

      {del.error && <ErrorText>{(del.error as Error).message}</ErrorText>}

      <RecipeEditor item={it} />

      {it.kind !== "build_assembly" && <SellOptions item={it} />}

      {it.track_stock && (
        <section>
          <h3 className="mb-2 font-semibold">Stock history</h3>
          {history.isLoading ? (
            <Spinner />
          ) : !history.data?.items.length ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-soft">
              No stock recorded yet.{" "}
              {can("catalogue.manage")
                ? "Enter the opening stock, or add a purchase."
                : "It appears here after a purchase."}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {history.data.items.map((m) => (
                  <li
                    key={m.id}
                    className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium">
                      {MOVEMENT_LABEL[m.type] ?? m.type}
                      {m.reason && (
                        <span className="font-normal text-ink-soft">
                          {" "}
                          · {m.reason}
                        </span>
                      )}
                    </span>
                    <span
                      className={clsx(
                        "text-right font-semibold tabular",
                        m.qty < 0 ? "text-danger" : "text-ok",
                      )}
                    >
                      {m.qty > 0 ? "+" : ""}
                      {m.qty_display}
                    </span>
                    <span className="text-xs text-ink-soft">
                      {formatDateTime(m.created_at)}
                      {m.user && ` · ${m.user.name}`}
                    </span>
                    <span className="text-right text-xs text-ink-soft tabular">
                      balance {fmtBalance(it, m.balance_after)}
                    </span>
                  </li>
                ))}
              </ul>
              {history.data.total > history.data.page_size && (
                <div className="mt-2 flex items-center justify-end gap-2 text-sm text-ink-soft">
                  <span className="tabular">
                    page {page} of{" "}
                    {Math.ceil(history.data.total / history.data.page_size)}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label="Newer"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      page * history.data.page_size >= history.data.total
                    }
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Older"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** Balance in the same words as the main stock figure, computed client-side. */
function fmtBalance(item: Item, qty: number): string {
  const size = item.unit_size;
  if (size === 1) return `${qty}`;
  if (item.stock_unit === "kg" || item.stock_unit === "litre")
    return `${Math.round((qty / size) * 1000) / 1000} ${item.stock_unit}`;
  const whole = Math.floor(qty / size);
  const rest = Math.round((qty - whole * size) * 1000) / 1000;
  return rest ? `${whole} + ${rest}` : `${whole}`;
}

function StockAction({
  item,
  action,
  onDone,
  onCancel,
}: {
  item: Item;
  action: Exclude<Action, null>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(
    action === "count" ? Math.max(item.on_hand, 0) : 0,
  );
  const [cost, setCost] = useState(
    item.cost_price ? String(item.cost_price) : "",
  );
  const [reason, setReason] = useState(action === "count" ? "Stock count" : "");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      if (action === "opening")
        return api<Item>(`/items/${item.id}/opening`, {
          method: "POST",
          json: { qty, cost_per_unit: Number(cost) || 0 },
        });
      if (action === "wastage")
        return api<Item>(`/items/${item.id}/wastage`, {
          method: "POST",
          json: { qty, reason },
        });
      return api<Item>(`/items/${item.id}/count`, {
        method: "POST",
        json: { counted: qty, reason },
      });
    },
    onSuccess: onDone,
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  const titles = {
    opening: "Enter opening stock",
    count: "Count stock",
    wastage: "Record wastage",
  };
  const help = {
    opening:
      "How much is on the shelf right now, before you start using the system. You can only do this once per item.",
    count: `The system thinks there is ${item.on_hand_display}. Enter what you actually counted; the difference is recorded.`,
    wastage: "Stock that was spilled, broken, spoiled or thrown away.",
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (action === "wastage" && qty <= 0)
      return setError("Enter how much was wasted.");
    if (action === "wastage" && reason.trim().length < 2)
      return setError("Say what happened, e.g. bottle broke.");
    save.mutate();
  }

  const diff = qty - item.on_hand;

  return (
    <form onSubmit={submit} className="space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden /> Back to {item.name}
      </button>
      <h3 className="text-lg font-semibold">{titles[action]}</h3>
      <p className="text-sm text-ink-soft">{help[action]}</p>

      <QtyInput
        item={item}
        value={qty}
        onChange={setQty}
        label={
          action === "count"
            ? "Counted"
            : action === "wastage"
              ? "Amount wasted"
              : "Quantity in stock"
        }
      />

      {action === "count" && diff !== 0 && (
        <p
          className={clsx(
            "text-sm font-medium",
            diff < 0 ? "text-danger" : "text-ok",
          )}
        >
          {diff < 0 ? "Short by" : "Over by"}{" "}
          {Math.abs(Math.round(diff * 1000) / 1000)}{" "}
          {item.base_unit === "piece" ? "pcs" : item.base_unit}
        </p>
      )}

      {action === "opening" && (
        <div className="max-w-xs">
          <Field
            label={`Cost per ${item.stock_unit}`}
            hint="Used to value the stock until the next purchase."
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="tabular"
              />
            )}
          </Field>
        </div>
      )}
      {action !== "opening" && (
        <Field label={action === "wastage" ? "What happened?" : "Note"}>
          {(id) => (
            <Input
              id={id}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                action === "wastage"
                  ? "e.g. Bottle dropped, chicken went bad"
                  : ""
              }
              maxLength={300}
            />
          )}
        </Field>
      )}

      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" busy={save.isPending}>
          {action === "opening"
            ? "Save opening stock"
            : action === "count"
              ? "Save count"
              : "Record wastage"}
        </Button>
      </div>
    </form>
  );
}
