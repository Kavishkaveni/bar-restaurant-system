"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { TriangleAlert, Wine } from "lucide-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Spinner,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeOf } from "@/lib/pos";
import type { BottleItem, OpenBottle } from "@/lib/types";

/** Which bottles are open for pegs, how much is left in each, and how many are still sealed. */
export function OpenBottlesTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const allowed = can("bar.open_bottle");
  const list = useQuery({
    queryKey: ["open-bottles"],
    queryFn: () => api<BottleItem[]>("/open-bottles"),
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const [finishing, setFinishing] = useState<{
    item: BottleItem;
    bottle: OpenBottle;
  } | null>(null);
  const [error, setError] = useState("");

  const open = useMutation({
    mutationFn: (itemId: number) =>
      api<BottleItem>(`/items/${itemId}/bottles/open`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["open-bottles"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not open"),
  });

  if (list.isLoading) return <Spinner />;
  const items = list.data ?? [];

  if (!items.length) {
    return (
      <Panel className="px-6 py-12 text-center">
        <p className="font-semibold">No bottle-measured liquor yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
          Add liquor as &quot;Bottles measured in ml&quot;, then add peg sizes
          under &quot;How it&apos;s sold&quot; (for example a 60 ml peg).
          Selling a peg opens a bottle automatically.
        </p>
      </Panel>
    );
  }

  return (
    <>
      <p className="mb-4 max-w-prose text-sm text-ink-soft">
        Pegs pour from the oldest open bottle, and a new one opens automatically
        when it runs out. When a bottle is really empty, tap
        <span className="font-medium text-ink"> Empty</span>: anything the
        system still shows in it is recorded as wastage.
      </p>
      <ErrorText>{error}</ErrorText>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((b) => (
          <li key={b.item_id}>
            <Panel className={clsx("p-4", b.running_low && "border-amber-500")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{b.name}</p>
                  <p className="text-sm text-ink-soft">
                    {b.category} · {b.on_hand_display} in stock
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-bottle-100 px-2.5 py-1 text-xs font-semibold text-bottle-800 tabular">
                  {b.sealed} sealed
                </span>
              </div>

              {b.open.length === 0 ? (
                <p className="mt-3 text-sm text-ink-soft">No bottle open.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {b.open.map((bottle) => {
                    const pct = Math.max(
                      0,
                      Math.min(
                        100,
                        (bottle.remaining_ml / bottle.size_ml) * 100,
                      ),
                    );
                    const low =
                      b.smallest_pour != null &&
                      bottle.remaining_ml < b.smallest_pour;
                    return (
                      <li key={bottle.id} className="flex items-center gap-3">
                        <Wine
                          className={clsx(
                            "size-5 shrink-0",
                            low ? "text-danger" : "text-amber-600",
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium tabular">
                              {Math.round(bottle.remaining_ml)} ml left
                            </span>
                            <span className="text-xs text-ink-soft">
                              opened {timeOf(bottle.opened_at)}
                            </span>
                          </div>
                          <div
                            className="mt-1 h-2 overflow-hidden rounded-full bg-ground"
                            role="meter"
                            aria-valuemin={0}
                            aria-valuemax={bottle.size_ml}
                            aria-valuenow={bottle.remaining_ml}
                            aria-label={`${b.name} open bottle`}
                          >
                            <div
                              className={clsx(
                                "h-full rounded-full",
                                low ? "bg-danger" : "bg-amber-500",
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        {allowed && (
                          <Button
                            variant="secondary"
                            onClick={() => setFinishing({ item: b, bottle })}
                          >
                            Empty
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {b.running_low && (
                <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-amber-600">
                  <TriangleAlert className="size-4" aria-hidden /> Almost out
                  and no sealed bottles left
                </p>
              )}
              {allowed && (
                <Button
                  variant="ghost"
                  className="mt-2"
                  disabled={b.sealed < 1}
                  busy={open.isPending && open.variables === b.item_id}
                  onClick={() => open.mutate(b.item_id)}
                >
                  Open a bottle
                </Button>
              )}
            </Panel>
          </li>
        ))}
      </ul>
      <FinishDialog target={finishing} onClose={() => setFinishing(null)} />
    </>
  );
}

function FinishDialog({
  target,
  onClose,
}: {
  target: { item: BottleItem; bottle: OpenBottle } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("Bottle is empty");
  const [error, setError] = useState("");
  const finish = useMutation({
    mutationFn: () =>
      api<BottleItem>(`/open-bottles/${target!.bottle.id}/finish`, {
        method: "POST",
        json: { reason },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["open-bottles"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  const left = target ? Math.round(target.bottle.remaining_ml) : 0;
  return (
    <Modal
      open={target !== null}
      title={`Empty ${target?.item.name ?? ""} bottle`}
      onClose={onClose}
    >
      <div className="space-y-4">
        {left > 0 ? (
          <p className="text-sm">
            The system says{" "}
            <span className="font-semibold tabular">{left} ml</span> should
            still be in this bottle. If it&apos;s really empty, those {left} ml
            were poured without being sold (over-pouring, spills or free drinks)
            and will be recorded as wastage.
          </p>
        ) : (
          <p className="text-sm">This bottle is used up exactly as sold.</p>
        )}
        <Field label="Note">
          {(id) => (
            <Input
              id={id}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
            />
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={left > 0 ? "danger" : "primary"}
            busy={finish.isPending}
            onClick={() => finish.mutate()}
          >
            {left > 0 ? `Empty and record ${left} ml wastage` : "Mark empty"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}