"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarPlus, DoorOpen, Search, Sparkles, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import { BookingForm } from "@/components/rooms/BookingForm";
import { RoomSetup } from "@/components/rooms/RoomSetup";
import {
  Badge,
  Button,
  ErrorText,
  Input,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  Tabs,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import {
  HOUSEKEEPING_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  shortDate,
  stayTime,
} from "@/lib/rooms";
import type { Board, BoardRoom, BookingBrief, Housekeeping } from "@/lib/types";

type Tab = "board" | "bookings" | "setup";

export default function RoomsPage() {
  const [tab, setTab] = useState<Tab>("board");
  const [form, setForm] = useState<{ walkIn: boolean; roomId?: number } | null>(
    null,
  );
  return (
    <Guard anyOf={["rooms.manage"]}>
      <PageHeader
        title="Rooms"
        description="Who is staying, who is arriving, and which rooms are ready."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setForm({ walkIn: false })}
            >
              <CalendarPlus className="size-4" aria-hidden /> New booking
            </Button>
            <Button onClick={() => setForm({ walkIn: true })}>
              <DoorOpen className="size-4" aria-hidden /> Walk-in
            </Button>
          </div>
        }
      />
      <Tabs
        tabs={[
          { key: "board", label: "Room board" },
          { key: "bookings", label: "Bookings" },
          { key: "setup", label: "Rooms and prices" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "board" && (
        <RoomBoard
          onBook={(roomId) => setForm({ walkIn: false, roomId })}
          onWalkIn={(roomId) => setForm({ walkIn: true, roomId })}
        />
      )}
      {tab === "bookings" && <BookingList />}
      {tab === "setup" && <RoomSetup />}
      <BookingForm
        open={form !== null}
        walkIn={form?.walkIn ?? false}
        roomId={form?.roomId}
        onClose={() => setForm(null)}
      />
    </Guard>
  );
}

const STATE_STYLE: Record<BoardRoom["state"], string> = {
  free: "border-line bg-surface",
  occupied: "border-bottle-700 bg-bottle-100",
  arriving: "border-amber-500 bg-amber-100",
  overdue: "border-danger bg-danger-soft",
};
const STATE_LABEL: Record<BoardRoom["state"], string> = {
  free: "Free",
  occupied: "Occupied",
  arriving: "Arriving today",
  overdue: "Past check-out time",
};

function RoomBoard({
  onBook,
  onWalkIn,
}: {
  onBook: (roomId: number) => void;
  onWalkIn: (roomId: number) => void;
}) {
  const router = useRouter();
  const board = useQuery({
    queryKey: ["room-board"],
    queryFn: () => api<Board>("/rooms/board"),
    refetchInterval: 30_000,
  });
  const [picked, setPicked] = useState<BoardRoom | null>(null);

  if (board.isLoading) return <Spinner />;
  const d = board.data;
  if (!d || d.rooms.length === 0) {
    return (
      <Panel className="px-6 py-12 text-center">
        <p className="font-semibold">No rooms yet</p>
        <p className="mt-1 text-sm text-ink-soft">
          Open &quot;Rooms and prices&quot; to add your room types and rooms.
        </p>
      </Panel>
    );
  }
  const floors = [...new Set(d.rooms.map((r) => r.floor))];

  return (
    <>
      <dl className="mb-5 grid grid-cols-3 gap-3 sm:max-w-xl">
        <Count label="In house" value={d.in_house} />
        <Count label="Arriving today" value={d.arrivals_today} />
        <Count label="Leaving today" value={d.departures_today} />
      </dl>
      {floors.map((floor) => (
        <section key={floor} className="mb-6">
          {floors.length > 1 && (
            <h2 className="mb-2 text-sm font-semibold text-ink-soft">
              {floor ? `Floor ${floor}` : "Other rooms"}
            </h2>
          )}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {d.rooms
              .filter((r) => r.floor === floor)
              .map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => {
                      const b =
                        r.stay ?? (r.state === "arriving" ? r.next : null);
                      if (b) router.push(`/rooms/bookings/${b.id}`);
                      else setPicked(r);
                    }}
                    className={clsx(
                      "flex h-36 w-full flex-col justify-between rounded-xl border-2 p-3 text-left transition-colors hover:brightness-95",
                      STATE_STYLE[r.state],
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block text-lg font-bold">
                          {r.number}
                        </span>
                        <span className="block text-xs text-ink-soft">
                          {r.room_type.name}
                        </span>
                      </span>
                      {r.housekeeping !== "clean" && (
                        <HousekeepingIcon status={r.housekeeping} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={clsx(
                          "block text-xs font-semibold",
                          r.state === "overdue" && "text-danger",
                        )}
                      >
                        {STATE_LABEL[r.state]}
                      </span>
                      {r.stay ? (
                        <>
                          <span className="block truncate text-sm font-medium">
                            {r.stay.guest_name}
                          </span>
                          <span className="block text-xs text-ink-soft">
                            until {shortDate(r.stay.departure)}
                          </span>
                        </>
                      ) : r.next ? (
                        <span className="block truncate text-xs text-ink-soft">
                          Next: {r.next.guest_name}, {shortDate(r.next.arrival)}
                        </span>
                      ) : (
                        <span className="block text-xs text-ink-soft">
                          {HOUSEKEEPING_LABEL[r.housekeeping]}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <RoomActions
        room={picked}
        onClose={() => setPicked(null)}
        onBook={onBook}
        onWalkIn={onWalkIn}
      />
    </>
  );
}

function HousekeepingIcon({ status }: { status: Housekeeping }) {
  return status === "dirty" ? (
    <span
      className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-600"
      title="Needs cleaning"
    >
      <Sparkles className="size-3.5" aria-hidden /> To clean
    </span>
  ) : (
    <span
      className="flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger"
      title="Maintenance"
    >
      <Wrench className="size-3.5" aria-hidden /> Fix
    </span>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="text-2xl font-bold tabular">{value}</dd>
    </div>
  );
}

/** A free room: book it, check a walk-in into it, or change its housekeeping state. */
function RoomActions({
  room,
  onClose,
  onBook,
  onWalkIn,
}: {
  room: BoardRoom | null;
  onClose: () => void;
  onBook: (roomId: number) => void;
  onWalkIn: (roomId: number) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const set = useMutation({
    mutationFn: (housekeeping: Housekeeping) =>
      api(`/rooms/${room!.id}/housekeeping`, {
        method: "POST",
        json: { housekeeping },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["room-board"] });
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  if (!room)
    return (
      <Modal open={false} title="" onClose={onClose}>
        {null}
      </Modal>
    );
  return (
    <Modal open title={`Room ${room.number}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          {room.room_type.name} ·{" "}
          <span className="font-medium">
            {HOUSEKEEPING_LABEL[room.housekeeping]}
          </span>
        </p>
        {room.next && (
          <p className="rounded-lg bg-ground px-3 py-2 text-sm">
            Next booking: {room.next.guest_name}, {stayTime(room.next.arrival)}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            size="lg"
            disabled={room.housekeeping === "maintenance"}
            onClick={() => (onClose(), onWalkIn(room.id))}
          >
            <DoorOpen className="size-5" aria-hidden /> Check in a guest
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => (onClose(), onBook(room.id))}
          >
            <CalendarPlus className="size-5" aria-hidden /> Book for later
          </Button>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Housekeeping</p>
          <div className="flex flex-wrap gap-2">
            {(["clean", "dirty", "maintenance"] as const).map((h) => (
              <Button
                key={h}
                variant={room.housekeeping === h ? "primary" : "secondary"}
                busy={set.isPending && set.variables === h}
                onClick={() => set.mutate(h)}
              >
                {HOUSEKEEPING_LABEL[h]}
              </Button>
            ))}
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}

function BookingList() {
  const money = useMoney();
  const router = useRouter();
  const [view, setView] = useState<"upcoming" | "in_house" | "past">(
    "upcoming",
  );
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["bookings", view, q],
    queryFn: () =>
      api<BookingBrief[]>(`/bookings?view=${view}&q=${encodeURIComponent(q)}`),
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["upcoming", "Upcoming"],
            ["in_house", "In house"],
            ["past", "Past"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={clsx(
              "h-9 rounded-full px-4 text-sm font-semibold ring-1",
              view === k
                ? "bg-bottle-900 text-white ring-bottle-900"
                : "ring-line hover:bg-ground",
            )}
          >
            {label}
          </button>
        ))}
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Search guests</span>
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, phone or ID"
            className="pl-9"
          />
        </label>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.length ? (
        <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
          No bookings here.
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {list.data.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => router.push(`/rooms/bookings/${b.id}`)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-ground"
                >
                  <span className="w-14 shrink-0 text-center">
                    <span className="block text-lg font-bold">
                      {b.room.number}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {b.guest_name}
                    </span>
                    <span className="block text-sm text-ink-soft">
                      {stayTime(b.arrival)} → {stayTime(b.departure)}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[b.status]}>
                    {STATUS_LABEL[b.status]}
                  </Badge>
                  <span className="hidden text-right sm:block">
                    <span className="block font-semibold tabular">
                      {money(b.total)}
                    </span>
                    {b.balance > 0 && b.status !== "cancelled" && (
                      <span className="block text-xs text-ink-soft tabular">
                        {money(b.balance)} due
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
