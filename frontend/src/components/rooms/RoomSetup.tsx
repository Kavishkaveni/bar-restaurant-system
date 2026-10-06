"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Spinner,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import type { Room, RoomType } from "@/lib/types";

/** Room types (with their prices) and the rooms themselves. */
export function RoomSetup() {
  const money = useMoney();
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ["room-types"],
    queryFn: () => api<RoomType[]>("/room-types"),
  });
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api<Room[]>("/rooms"),
  });
  const [editType, setEditType] = useState<RoomType | "new" | null>(null);
  const [editRoom, setEditRoom] = useState<Room | "new" | null>(null);
  const [error, setError] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["room-types"] });
    qc.invalidateQueries({ queryKey: ["rooms"] });
    qc.invalidateQueries({ queryKey: ["room-board"] });
  };
  const del = useMutation({
    mutationFn: (path: string) => api(path, { method: "DELETE" }),
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not delete"),
  });

  if (types.isLoading || rooms.isLoading) return <Spinner />;
  const typeList = types.data ?? [];
  const roomList = rooms.data ?? [];

  return (
    <div className="space-y-8">
      <ErrorText>{error}</ErrorText>
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Room types and prices</h2>
            <p className="text-sm text-ink-soft">
              For example Standard AC, Deluxe, Family. Each has its own price.
            </p>
          </div>
          <Button onClick={() => setEditType("new")}>
            <Plus className="size-4" aria-hidden /> Add room type
          </Button>
        </div>
        {typeList.length === 0 ? (
          <Panel className="px-6 py-10 text-center text-sm text-ink-soft">
            Add a room type first, then add your rooms.
          </Panel>
        ) : (
          <Panel>
            <ul className="divide-y divide-line">
              {typeList.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {t.room_count} {t.room_count === 1 ? "room" : "rooms"} ·
                      up to {t.max_guests} guests
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block font-semibold tabular">
                      {money(t.nightly_rate)} / night
                    </span>
                    {t.short_stay_rate != null && (
                      <span className="block text-ink-soft tabular">
                        {money(t.short_stay_rate)} / {t.short_stay_hours} h
                        {t.extra_hour_rate
                          ? ` + ${money(t.extra_hour_rate)} / extra h`
                          : ""}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => setEditType(t)}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => del.mutate(`/room-types/${t.id}`)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Rooms</h2>
            <p className="text-sm text-ink-soft">
              Each room number and its type.
            </p>
          </div>
          <Button
            onClick={() => setEditRoom("new")}
            disabled={typeList.length === 0}
          >
            <Plus className="size-4" aria-hidden /> Add room
          </Button>
        </div>
        {roomList.length === 0 ? (
          <Panel className="px-6 py-10 text-center text-sm text-ink-soft">
            No rooms yet.
          </Panel>
        ) : (
          <Panel>
            <ul className="divide-y divide-line">
              {roomList.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <BedDouble
                    className="size-5 shrink-0 text-ink-soft"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Room {r.number}</span>
                    <span className="block text-sm text-ink-soft">
                      {r.room_type.name}
                      {r.floor && ` · Floor ${r.floor}`}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    aria-label={`Edit room ${r.number}`}
                    onClick={() => setEditRoom(r)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete room ${r.number}`}
                    onClick={() => del.mutate(`/rooms/${r.id}`)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      <TypeForm
        key={editType === "new" ? "new" : (editType?.id ?? "none")}
        editing={editType}
        onClose={() => setEditType(null)}
        onSaved={refresh}
      />
      <RoomForm
        key={editRoom === "new" ? "new-room" : (editRoom?.id ?? "no-room")}
        editing={editRoom}
        types={typeList}
        onClose={() => setEditRoom(null)}
        onSaved={refresh}
      />
    </div>
  );
}

function TypeForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: RoomType | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = editing && editing !== "new" ? editing : null;
  const [name, setName] = useState(t?.name ?? "");
  const [nightly, setNightly] = useState(t ? String(t.nightly_rate) : "");
  const [shortRate, setShortRate] = useState(
    t?.short_stay_rate != null ? String(t.short_stay_rate) : "",
  );
  const [shortHours, setShortHours] = useState(
    String(t?.short_stay_hours ?? 3),
  );
  const [extraHour, setExtraHour] = useState(
    t?.extra_hour_rate != null ? String(t.extra_hour_rate) : "",
  );
  const [guests, setGuests] = useState(String(t?.max_guests ?? 2));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        nightly_rate: Number(nightly) || 0,
        short_stay_rate: shortRate === "" ? null : Number(shortRate),
        short_stay_hours: Number(shortHours) || 3,
        extra_hour_rate: extraHour === "" ? null : Number(extraHour),
        max_guests: Number(guests) || 1,
      };
      return t
        ? api(`/room-types/${t.id}`, { method: "PUT", json: body })
        : api("/room-types", { method: "POST", json: body });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  return (
    <Modal
      open={editing !== null}
      title={t ? `Edit ${t.name}` : "Add room type"}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard AC"
              required
              maxLength={60}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price per night">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={nightly}
                onChange={(e) => setNightly(e.target.value)}
                required
                className="tabular"
              />
            )}
          </Field>
          <Field label="Max guests">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={50}
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
                className="tabular"
              />
            )}
          </Field>
        </div>
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">
            Short stay (optional)
          </legend>
          <p className="mb-3 text-sm text-ink-soft">
            For day use by the hour. Leave empty if you don&apos;t offer it.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Price">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step="0.01"
                  value={shortRate}
                  onChange={(e) => setShortRate(e.target.value)}
                  className="tabular"
                />
              )}
            </Field>
            <Field label="For hours">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={24}
                  value={shortHours}
                  onChange={(e) => setShortHours(e.target.value)}
                  className="tabular"
                />
              )}
            </Field>
            <Field label="Each extra hour">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step="0.01"
                  value={extraHour}
                  onChange={(e) => setExtraHour(e.target.value)}
                  className="tabular"
                />
              )}
            </Field>
          </div>
        </fieldset>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending}>
            {t ? "Save changes" : "Add room type"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RoomForm({
  editing,
  types,
  onClose,
  onSaved,
}: {
  editing: Room | "new" | null;
  types: RoomType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const r = editing && editing !== "new" ? editing : null;
  const [number, setNumber] = useState(r?.number ?? "");
  const [typeId, setTypeId] = useState<number | "">(
    r?.room_type.id ?? types[0]?.id ?? "",
  );
  const [floor, setFloor] = useState(r?.floor ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const body = {
        number,
        room_type_id: typeId,
        floor,
        note: r?.note ?? "",
        sort_order: r?.sort_order ?? 0,
      };
      return r
        ? api(`/rooms/${r.id}`, { method: "PUT", json: body })
        : api("/rooms", { method: "POST", json: body });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  return (
    <Modal
      open={editing !== null}
      title={r ? `Edit room ${r.number}` : "Add room"}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Room number">
            {(id) => (
              <Input
                id={id}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="e.g. 101"
                required
                maxLength={20}
              />
            )}
          </Field>
          <Field label="Floor (optional)">
            {(id) => (
              <Input
                id={id}
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                maxLength={20}
              />
            )}
          </Field>
        </div>
        <Field label="Room type">
          {(id) => (
            <Select
              id={id}
              value={typeId}
              onChange={(e) => setTypeId(Number(e.target.value))}
              required
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending}>
            {r ? "Save changes" : "Add room"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
