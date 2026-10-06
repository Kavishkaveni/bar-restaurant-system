"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, BellOff, ChefHat, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Guard } from "@/components/Guard";
import { Button, ErrorText, PageHeader, Panel, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { minutesSince, qtyText, timeOf } from "@/lib/pos";
import { readJSON, writeJSON } from "@/lib/storage";
import type { KitchenStatus, Ticket, TicketLine } from "@/lib/types";

const NEXT: Record<KitchenStatus, { to: KitchenStatus; label: string } | null> =
  {
    new: { to: "preparing", label: "Start" },
    preparing: { to: "ready", label: "Ready" },
    ready: { to: "served", label: "Served" },
    served: null,
  };
const BACK: Partial<Record<KitchenStatus, KitchenStatus>> = {
  preparing: "new",
  ready: "preparing",
};
const STATUS_STYLE: Record<KitchenStatus, string> = {
  new: "bg-amber-100 text-amber-600",
  preparing: "bg-bottle-100 text-bottle-800",
  ready: "bg-ok-soft text-ok",
  served: "bg-ground text-ink-soft",
};
const STATUS_LABEL: Record<KitchenStatus, string> = {
  new: "New",
  preparing: "Cooking",
  ready: "Ready",
  served: "Served",
};
const SOUND_KEY = "kitchen-sound";

export default function KitchenPage() {
  return (
    <Guard anyOf={["kitchen.view", "pos.order"]}>
      <KitchenBoard />
    </Guard>
  );
}

function KitchenBoard() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const isCook = can("kitchen.view");
  const live = useLive();
  const tickets = useQuery({
    queryKey: ["kitchen"],
    queryFn: () => api<Ticket[]>("/kitchen/tickets"),
    refetchInterval: live ? 30_000 : 5_000, // live updates bring new orders at once
    refetchIntervalInBackground: true,
  });
  const [sound, setSound] = useState(
    () => readJSON<boolean>(SOUND_KEY) !== false,
  );
  const [error, setError] = useState("");
  const [, tick] = useState(0);
  const seen = useRef<Set<number> | null>(null);

  // Keep the "waiting for" timers moving.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Beep when food that wasn't on the screen before arrives.
  useEffect(() => {
    if (!tickets.data) return;
    const ids = new Set(
      tickets.data.flatMap((t) =>
        t.lines.filter((l) => l.kitchen_status === "new").map((l) => l.id),
      ),
    );
    const fresh =
      seen.current !== null && [...ids].some((id) => !seen.current!.has(id));
    seen.current = new Set([...(seen.current ?? []), ...ids]);
    if (fresh && sound) beep();
  }, [tickets.data, sound]);

  const move = useMutation({
    mutationFn: ({ line, to }: { line: TicketLine; to: KitchenStatus }) =>
      api<TicketLine>(`/kitchen/lines/${line.id}/status`, {
        method: "POST",
        json: { status: to },
      }),
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["kitchen"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not update"),
  });

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    writeJSON(SOUND_KEY, next);
    if (next) beep();
  };

  const list = tickets.data ?? [];
  const counts = list
    .flatMap((t) => t.lines)
    .reduce(
      (acc, l) => ({
        ...acc,
        [l.kitchen_status]: (acc[l.kitchen_status] ?? 0) + 1,
      }),
      {} as Partial<Record<KitchenStatus, number>>,
    );

  return (
    <>
      <PageHeader
        title="Kitchen"
        description={
          isCook
            ? "Food orders appear here by themselves. Tap Start when you begin cooking, Ready when it can go out."
            : "Food that is cooking or ready to take to the table."
        }
        action={
          <Button
            variant="secondary"
            onClick={toggleSound}
            aria-pressed={sound}
          >
            {sound ? (
              <Bell className="size-4" aria-hidden />
            ) : (
              <BellOff className="size-4" aria-hidden />
            )}
            {sound ? "Sound on" : "Sound off"}
          </Button>
        }
      />
      <p className="mb-4 flex flex-wrap gap-2 text-sm" aria-live="polite">
        {(["new", "preparing", "ready"] as const).map((s) => (
          <span
            key={s}
            className={clsx(
              "rounded-full px-3 py-1 font-medium",
              STATUS_STYLE[s],
            )}
          >
            {STATUS_LABEL[s]}: <span className="tabular">{counts[s] ?? 0}</span>
          </span>
        ))}
      </p>
      <ErrorText>{error}</ErrorText>
      {tickets.isLoading ? (
        <Spinner />
      ) : tickets.isError ? (
        <ErrorText>
          {tickets.error instanceof ApiError
            ? tickets.error.message
            : "Could not load the kitchen orders"}
        </ErrorText>
      ) : list.length === 0 ? (
        <Panel className="flex flex-col items-center px-6 py-16 text-center">
          <ChefHat className="mb-3 size-10 text-ink-soft" aria-hidden />
          <p className="font-semibold">No food waiting</p>
          <p className="mt-1 text-sm text-ink-soft">
            New food orders from the POS will show up here within a few seconds.
          </p>
        </Panel>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const waitMins =
              (Date.now() - new Date(t.oldest).getTime()) / 60000;
            return (
              <li key={t.order_id}>
                <Panel
                  className={clsx(
                    "overflow-hidden",
                    waitMins >= 20 && "border-danger",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 border-b border-line bg-ground px-4 py-2.5">
                    <p className="truncate text-lg font-semibold">{t.label}</p>
                    <p
                      className={clsx(
                        "shrink-0 text-sm tabular",
                        waitMins >= 20
                          ? "font-semibold text-danger"
                          : "text-ink-soft",
                      )}
                    >
                      {minutesSince(t.oldest)}
                    </p>
                  </div>
                  {(t.waiter || t.order_note) && (
                    <p className="px-4 pt-2 text-sm text-ink-soft">
                      {t.waiter && <>Waiter: {t.waiter}</>}
                      {t.waiter && t.order_note && " · "}
                      {t.order_note && (
                        <span className="font-medium text-ink">
                          {t.order_note}
                        </span>
                      )}
                    </p>
                  )}
                  <ul className="divide-y divide-line">
                    {t.lines.map((l) => {
                      const next = NEXT[l.kitchen_status];
                      const back = BACK[l.kitchen_status];
                      // Waiters can only mark ready food as served; the cooks move everything else.
                      const canMove = isCook || l.kitchen_status === "ready";
                      return (
                        <li
                          key={l.id}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">
                              <span className="tabular">
                                {qtyText(l.qty)} ×
                              </span>{" "}
                              {l.name}
                            </p>
                            {l.note && (
                              <p className="text-sm font-medium text-amber-600">
                                {l.note}
                              </p>
                            )}
                            <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
                              <span
                                className={clsx(
                                  "rounded-full px-2 py-0.5 font-medium",
                                  STATUS_STYLE[l.kitchen_status],
                                )}
                              >
                                {STATUS_LABEL[l.kitchen_status]}
                              </span>
                              ordered {timeOf(l.created_at)}
                            </p>
                          </div>
                          {isCook && back && (
                            <Button
                              variant="ghost"
                              aria-label={`Move ${l.name} back to ${STATUS_LABEL[back]}`}
                              disabled={move.isPending}
                              onClick={() => move.mutate({ line: l, to: back })}
                            >
                              <Undo2 className="size-4" aria-hidden />
                            </Button>
                          )}
                          {next && canMove && (
                            <Button
                              variant={
                                l.kitchen_status === "ready"
                                  ? "secondary"
                                  : "primary"
                              }
                              size="lg"
                              busy={
                                move.isPending &&
                                move.variables?.line.id === l.id
                              }
                              onClick={() =>
                                move.mutate({ line: l, to: next.to })
                              }
                            >
                              {next.label}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** A short two-tone chime, made in the browser so no sound file is needed. */
function beep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.17);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {
    // Some browsers block sound until the page is tapped once; nothing else to do.
  }
}
