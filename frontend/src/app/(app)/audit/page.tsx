"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import {
  Button,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  Spinner,
  formatDateTime,
} from "@/components/ui";
import { api } from "@/lib/api";
import type { AuditEntry, AuditPage } from "@/lib/types";

const ACTION_WORDS: Record<string, string> = {
  login: "logged in",
  pin_login: "logged in with PIN",
  pin_locked: "had their PIN locked after wrong tries",
  change_password: "changed their password",
  create: "created",
  update: "updated",
  update_permissions: "changed permissions of",
  delete: "deleted",
  restore: "restored",
  opening_stock: "entered opening stock for",
  wastage: "recorded wastage of",
  stock_count: "counted",
  payment: "recorded a payment on",
  cancel: "cancelled",
  open: "opened",
  paid: "closed and took payment for",
  void: "voided",
  discount: "gave a discount on",
  remove_discount: "removed the discount on",
  remove_line: "removed an item from",
  reduce_line: "reduced an item on",
  reprint: "reprinted",
  split: "split",
  merge: "merged a bill into",
  recipe: "changed the recipe of",
  produce: "made a batch of",
  open_bottle: "opened a bottle of",
  finish_bottle: "emptied a bottle of",
  check_in: "checked in",
  check_out: "checked out",
  add_charge: "added a charge to",
  remove_charge: "removed a charge from",
  charge_room: "charged to the room:",
  housekeeping: "changed housekeeping of",
  no_show: "marked as no-show",
  close: "closed",
  cash_in: "put cash into",
  cash_out: "took cash out of",
};

const ENTITY_WORDS: Record<string, string> = {
  user: "staff member",
  role: "role",
  settings: "settings",
  category: "category",
  item: "item",
  supplier: "supplier",
  purchase: "purchase from",
  order: "bill",
  table: "table",
  sell_option: "selling option",
  booking: "booking",
  room: "",
  room_type: "room type",
  shift: "cash drawer shift",
  expense: "expense",
  expense_category: "expense category",
};

// Stock actions read better without the word "item": "counted Arrack".
const NO_ENTITY_WORD = [
  "opening_stock",
  "wastage",
  "stock_count",
  "recipe",
  "produce",
  "open_bottle",
  "finish_bottle",
  "check_in",
  "check_out",
  "no_show",
  "housekeeping",
  "charge_room",
];

function describe(e: AuditEntry): string {
  const verb = ACTION_WORDS[e.action] ?? e.action.replaceAll("_", " ");
  if (
    ["login", "pin_login", "pin_locked", "change_password"].includes(e.action)
  )
    return verb;
  if (e.entity === "settings") return `${verb} settings`;
  const name =
    (e.after?.name as string) ??
    (e.before?.name as string) ??
    `#${e.entity_id}`;
  if (NO_ENTITY_WORD.includes(e.action)) return `${verb} ${name}`;
  const word = ENTITY_WORDS[e.entity] ?? e.entity;
  return word ? `${verb} ${word} ${name}` : `${verb} ${name}`;
}

function Changes({ e }: { e: AuditEntry }) {
  const keys = [
    ...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})]),
  ].filter(
    (k) => JSON.stringify(e.before?.[k]) !== JSON.stringify(e.after?.[k]),
  );
  if (!keys.length) return null;
  const show = (v: unknown) =>
    v === undefined || v === null || v === ""
      ? "—"
      : Array.isArray(v)
        ? v.join(", ")
        : String(v);
  return (
    <dl className="mt-2 grid gap-1 text-xs">
      {keys.map((k) => (
        <div key={k} className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-ink">{k.replaceAll("_", " ")}:</dt>
          <dd className="text-ink-soft">
            {e.before && (
              <span className="line-through">{show(e.before[k])}</span>
            )}
            {e.before && " → "}
            <span className="text-ink">{show(e.after?.[k])}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function AuditPageView() {
  return (
    <Guard anyOf={["audit.view"]}>
      <Audit />
    </Guard>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "30" });
  if (entity) params.set("entity", entity);
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);

  const query = useQuery({
    queryKey: ["audit", params.toString()],
    queryFn: () => api<AuditPage>(`/audit-log?${params}`),
    placeholderData: keepPreviousData,
  });

  const pages = query.data
    ? Math.max(1, Math.ceil(query.data.total / query.data.page_size))
    : 1;
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every login and every change, with who made it."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Area">
          {(id) => (
            <Select
              id={id}
              value={entity}
              onChange={(e) => reset(setEntity)(e.target.value)}
            >
              <option value="">Everything</option>
              <option value="user">Staff</option>
              <option value="role">Roles</option>
              <option value="settings">Settings</option>
              <option value="item">Items and stock</option>
              <option value="category">Categories</option>
              <option value="supplier">Suppliers</option>
              <option value="purchase">Purchases</option>
              <option value="order">Bills</option>
              <option value="table">Tables</option>
            </Select>
          )}
        </Field>
        <Field label="From">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={from}
              onChange={(e) => reset(setFrom)(e.target.value)}
            />
          )}
        </Field>
        <Field label="To">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={to}
              onChange={(e) => reset(setTo)(e.target.value)}
            />
          )}
        </Field>
      </div>

      {query.isLoading ? (
        <Spinner />
      ) : query.error ? (
        <ErrorText>{(query.error as Error).message}</ErrorText>
      ) : query.data!.items.length === 0 ? (
        <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
          Nothing recorded for these filters.
        </Panel>
      ) : (
        <>
          <Panel>
            <ul className="divide-y divide-line">
              {query.data!.items.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-6"
                >
                  <time className="shrink-0 text-sm text-ink-soft tabular sm:w-44">
                    {formatDateTime(e.created_at)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold">
                        {e.user?.name ?? "System"}
                      </span>{" "}
                      {describe(e)}
                    </p>
                    <Changes e={e} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-ink-soft tabular">
              {query.data!.total} entries · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
