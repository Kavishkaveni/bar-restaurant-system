"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, ErrorText, Field, Input, Modal } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { DiningTable } from "@/lib/types";

export function TablesManager({ open, tables, onClose }: { open: boolean; tables: DiningTable[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<DiningTable | "new" | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [seats, setSeats] = useState("4");
  const [error, setError] = useState("");

  const startEdit = (t: DiningTable | "new") => {
    setEditing(t);
    setError("");
    setName(t === "new" ? "" : t.name);
    setArea(t === "new" ? (tables.at(-1)?.area ?? "") : t.area);
    setSeats(t === "new" ? "4" : String(t.seats));
  };

  const done = () => {
    qc.invalidateQueries({ queryKey: ["tables"] });
    setEditing(null);
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not save");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        area,
        seats: Number(seats) || 1,
        sort_order: editing === "new" ? tables.length : (editing as DiningTable).sort_order,
      };
      return editing === "new"
        ? api("/tables", { method: "POST", json: body })
        : api(`/tables/${(editing as DiningTable).id}`, { method: "PUT", json: body });
    },
    onSuccess: done,
    onError,
  });
  const del = useMutation({ mutationFn: (id: number) => api(`/tables/${id}`, { method: "DELETE" }), onSuccess: done, onError });

  const areas = [...new Set(tables.map((t) => t.area).filter(Boolean))];

  return (
    <Modal open={open} title="Tables" onClose={onClose}>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            save.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Table name or number">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T1, Garden 3" required maxLength={40} />}</Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Area" hint="Groups tables on the floor screen.">
              {(id) => (
                <>
                  <Input id={id} list={`${id}-areas`} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Indoor" maxLength={40} />
                  <datalist id={`${id}-areas`}>
                    {areas.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Seats">{(id) => <Input id={id} type="number" min={1} max={100} value={seats} onChange={(e) => setSeats(e.target.value)} className="tabular" />}</Field>
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-between gap-2">
            {editing !== "new" ? (
              <Button type="button" variant="ghost" busy={del.isPending} onClick={() => del.mutate((editing as DiningTable).id)}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Back
              </Button>
            )}
            <Button type="submit" busy={save.isPending}>
              {editing === "new" ? "Add table" : "Save table"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {tables.length === 0 ? (
            <p className="text-sm text-ink-soft">No tables yet. Add each table so waiters can open bills against it.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {tables.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 font-medium">{t.name}</span>
                  <span className="text-ink-soft">{t.area || "No area"}</span>
                  <span className="text-ink-soft tabular">{t.seats} seats</span>
                  <Button variant="ghost" onClick={() => startEdit(t)} aria-label={`Edit ${t.name}`}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText>{error}</ErrorText>
          <Button onClick={() => startEdit("new")}>
            <Plus className="size-4" aria-hidden /> Add table
          </Button>
        </div>
      )}
    </Modal>
  );
}
