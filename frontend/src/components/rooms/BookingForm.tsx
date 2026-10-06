"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useRouter } from "next/navigation";
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
import { useMoney, useSettings } from "@/lib/money";
import {
  FOLIO_METHODS,
  ID_LABEL,
  addDays,
  dateInput,
  timeInput,
  toISO,
} from "@/lib/rooms";
import type {
  Booking,
  FolioMethod,
  IdType,
  Room,
  RoomType,
  StayType,
} from "@/lib/types";

/** New booking, or a walk-in guest checked in straight away. */
export function BookingForm({
  open,
  walkIn,
  roomId,
  onClose,
}: {
  open: boolean;
  walkIn: boolean;
  roomId?: number;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={walkIn ? "Walk-in guest: check in now" : "New booking"}
      onClose={onClose}
      size="lg"
    >
      {open && <Body walkIn={walkIn} roomId={roomId} onClose={onClose} />}
    </Modal>
  );
}

function Body({
  walkIn,
  roomId,
  onClose,
}: {
  walkIn: boolean;
  roomId?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const money = useMoney();
  const settings = useSettings().data;
  const checkInTime = settings?.check_in_time ?? "14:00";
  const checkOutTime = settings?.check_out_time ?? "12:00";
  const now = new Date();

  const [stay, setStay] = useState<StayType>("night");
  const [date, setDate] = useState(dateInput(now));
  const [nights, setNights] = useState("1");
  const [time, setTime] = useState(timeInput(now));
  const [hours, setHours] = useState("3");
  const [room, setRoom] = useState<number | "">(roomId ?? "");
  const [rate, setRate] = useState("");
  const [g, setG] = useState({
    guest_name: "",
    phone: "",
    id_type: "nic" as IdType,
    id_number: "",
    address: "",
    adults: "1",
    children: "0",
    vehicle_no: "",
    note: "",
  });
  const [advance, setAdvance] = useState("");
  const [method, setMethod] = useState<FolioMethod>("cash");
  const [error, setError] = useState("");

  // Planned times: nights run from the check-in time to the check-out time;
  // a short stay runs for the hours chosen. A walk-in starts now.
  const n = Math.max(1, Math.floor(Number(nights) || 1));
  const h = Math.max(1, Math.floor(Number(hours) || 1));
  const arrivalISO = walkIn
    ? now.toISOString()
    : stay === "night"
      ? toISO(date, checkInTime)
      : toISO(date, time);
  const departureISO =
    stay === "night"
      ? toISO(addDays(walkIn ? dateInput(now) : date, n), checkOutTime)
      : new Date(new Date(arrivalISO).getTime() + h * 3_600_000).toISOString();
  const valid = new Date(departureISO) > new Date(arrivalISO);

  const types = useQuery({
    queryKey: ["room-types"],
    queryFn: () => api<RoomType[]>("/room-types"),
  });
  const available = useQuery({
    queryKey: [
      "rooms-available",
      arrivalISO.slice(0, 16),
      departureISO.slice(0, 16),
    ],
    queryFn: () =>
      api<Room[]>(
        `/rooms/available?arrival=${encodeURIComponent(arrivalISO)}&departure=${encodeURIComponent(departureISO)}`,
      ),
    enabled: valid,
  });
  const rooms = available.data ?? [];
  const chosen = rooms.find((r) => r.id === room);
  const type = types.data?.find((t) => t.id === chosen?.room_type.id);
  const defaultRate =
    stay === "night" ? type?.nightly_rate : type?.short_stay_rate;
  const effectiveRate = rate === "" ? defaultRate : Number(rate);
  const estimate =
    effectiveRate == null
      ? null
      : stay === "night"
        ? effectiveRate * n
        : effectiveRate +
          Math.max(0, h - (type?.short_stay_hours ?? h)) *
            (type?.extra_hour_rate ?? 0);

  const save = useMutation({
    mutationFn: () =>
      api<Booking>("/bookings", {
        method: "POST",
        json: {
          ...g,
          adults: Number(g.adults) || 1,
          children: Number(g.children) || 0,
          room_id: room,
          stay_type: stay,
          arrival: arrivalISO,
          departure: departureISO,
          rate: rate === "" ? null : Number(rate),
          check_in_now: walkIn,
          advance:
            Number(advance) > 0 ? { method, amount: Number(advance) } : null,
        },
      }),
    onSuccess: (b) => {
      onClose();
      router.push(`/rooms/bookings/${b.id}`);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  const set =
    (k: keyof typeof g) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setG((x) => ({ ...x, [k]: e.target.value }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        if (!room) return setError("Choose a room.");
        save.mutate();
      }}
    >
      <div
        className="grid grid-cols-2 gap-2"
        role="radiogroup"
        aria-label="Type of stay"
      >
        {(
          [
            {
              k: "night",
              t: "Overnight",
              d: `Check in ${checkInTime}, check out ${checkOutTime}`,
            },
            { k: "short", t: "Short stay", d: "Day use, by the hour" },
          ] as const
        ).map((o) => (
          <button
            key={o.k}
            type="button"
            role="radio"
            aria-checked={stay === o.k}
            onClick={() => {
              setStay(o.k);
              setRate("");
            }}
            className={clsx(
              "rounded-lg border p-3 text-left text-sm",
              stay === o.k
                ? "border-amber-500 bg-amber-100/40"
                : "border-line hover:bg-ground",
            )}
          >
            <span className="block font-medium">{o.t}</span>
            <span className="block text-ink-soft">{o.d}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {!walkIn && (
          <Field label={stay === "night" ? "Arrival date" : "Date"}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={date}
                min={dateInput(now)}
                onChange={(e) => setDate(e.target.value || dateInput(now))}
                required
              />
            )}
          </Field>
        )}
        {stay === "night" ? (
          <Field
            label="Nights"
            hint={
              valid
                ? `Leaves ${new Date(departureISO).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${checkOutTime}`
                : undefined
            }
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={60}
                value={nights}
                onChange={(e) => setNights(e.target.value)}
                className="tabular"
                required
              />
            )}
          </Field>
        ) : (
          <>
            {!walkIn && (
              <Field label="From">
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                  />
                )}
              </Field>
            )}
            <Field label="Hours">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={24}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="tabular"
                  required
                />
              )}
            </Field>
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Room"
          hint={
            valid && !available.isLoading && rooms.length === 0
              ? "No rooms are free for these dates."
              : undefined
          }
        >
          {(id) => (
            <Select
              id={id}
              value={room}
              onChange={(e) => setRoom(Number(e.target.value))}
              required
            >
              <option value="" disabled>
                {available.isLoading ? "Checking…" : "Choose a free room"}
              </option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.number} · {r.room_type.name}
                  {r.housekeeping === "dirty"
                    ? " (needs cleaning)"
                    : r.housekeeping === "maintenance"
                      ? " (maintenance)"
                      : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={
            stay === "night"
              ? "Price per night"
              : `Price for ${type?.short_stay_hours ?? 3} hours`
          }
          hint={
            defaultRate != null
              ? `${type?.name} price is ${money(defaultRate)}. Change only for a special price.`
              : chosen && stay === "short"
                ? "This room type has no short-stay price. Enter one."
                : undefined
          }
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder={defaultRate != null ? String(defaultRate) : ""}
              className="tabular"
            />
          )}
        </Field>
      </div>
      {estimate != null && chosen && (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm">
          Room charge about{" "}
          <span className="font-semibold tabular">{money(estimate)}</span>
          {stay === "night" && ` for ${n} ${n === 1 ? "night" : "nights"}`}
          {settings &&
            settings.room_tax_percent > 0 &&
            ` + ${settings.room_tax_percent}% tax`}
        </p>
      )}

      <fieldset className="space-y-4 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Guest</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                value={g.guest_name}
                onChange={set("guest_name")}
                required
                maxLength={120}
              />
            )}
          </Field>
          <Field label="Phone">
            {(id) => (
              <Input
                id={id}
                type="tel"
                value={g.phone}
                onChange={set("phone")}
                required={walkIn}
                maxLength={40}
              />
            )}
          </Field>
          <Field label="ID type">
            {(id) => (
              <Select id={id} value={g.id_type} onChange={set("id_type")}>
                {(Object.keys(ID_LABEL) as IdType[]).map((k) => (
                  <option key={k} value={k}>
                    {ID_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={`${ID_LABEL[g.id_type]} number`}
            hint={walkIn ? undefined : "Can be added at check-in."}
          >
            {(id) => (
              <Input
                id={id}
                value={g.id_number}
                onChange={set("id_number")}
                required={walkIn}
                maxLength={40}
              />
            )}
          </Field>
          <Field label="Adults">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={50}
                value={g.adults}
                onChange={set("adults")}
                className="tabular"
              />
            )}
          </Field>
          <Field label="Children">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={50}
                value={g.children}
                onChange={set("children")}
                className="tabular"
              />
            )}
          </Field>
          <Field label="Address (optional)">
            {(id) => (
              <Input
                id={id}
                value={g.address}
                onChange={set("address")}
                maxLength={300}
              />
            )}
          </Field>
          <Field label="Vehicle number (optional)">
            {(id) => (
              <Input
                id={id}
                value={g.vehicle_no}
                onChange={set("vehicle_no")}
                maxLength={30}
              />
            )}
          </Field>
        </div>
        <Field label="Note (optional)">
          {(id) => (
            <Textarea
              id={id}
              value={g.note}
              onChange={set("note")}
              rows={2}
              maxLength={500}
            />
          )}
        </Field>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Advance paid now (optional)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              step="0.01"
              value={advance}
              onChange={(e) => setAdvance(e.target.value)}
              className="tabular"
            />
          )}
        </Field>
        {Number(advance) > 0 && (
          <Field label="Paid by">
            {(id) => (
              <Select
                id={id}
                value={method}
                onChange={(e) => setMethod(e.target.value as FolioMethod)}
              >
                {FOLIO_METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" busy={save.isPending} disabled={!valid}>
          {walkIn ? "Check in" : "Save booking"}
        </Button>
      </div>
    </form>
  );
}
