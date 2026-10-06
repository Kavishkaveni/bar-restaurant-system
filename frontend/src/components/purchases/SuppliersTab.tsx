"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, ErrorText, Field, Input, Modal, Panel, Spinner, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import type { Supplier } from "@/lib/types";

export function SuppliersTab() {
  const money = useMoney();
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/suppliers") });

  if (suppliers.isLoading) return <Spinner />;
  const list = suppliers.data ?? [];
  const owed = list.reduce((s, x) => s + x.balance_due, 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          {list.length > 0 && (
            <>
              You owe suppliers <span className="font-semibold text-ink tabular">{money(owed)}</span> in total.
            </>
          )}
        </p>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden /> Add supplier
        </Button>
      </div>

      {list.length === 0 ? (
        <Panel className="px-6 py-12 text-center">
          <p className="font-semibold">No suppliers yet</p>
          <p className="mt-1 text-sm text-ink-soft">Add the companies and shops you buy from. Every purchase needs one.</p>
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="flex flex-wrap gap-x-3 text-ink-soft">
                    {s.contact_person && <span>{s.contact_person}</span>}
                    {s.phone && (
                      <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 hover:text-ink">
                        <Phone className="size-3.5" aria-hidden /> {s.phone}
                      </a>
                    )}
                    <span>
                      {s.purchase_count} purchase{s.purchase_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-ink-soft">You owe</div>
                  <div className={clsx("font-semibold tabular", s.balance_due > 0 ? "text-amber-600" : "text-ink-soft")}>
                    {money(s.balance_due)}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                  <Pencil className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <SupplierForm key={editing === "new" ? "new" : editing?.id ?? "none"} editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function SupplierForm({ editing, onClose }: { editing: Supplier | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = editing === "new" ? null : editing;
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    contact_person: existing?.contact_person ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    address: existing?.address ?? "",
    notes: existing?.notes ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const done = () => {
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    onClose();
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not save");
  const save = useMutation({
    mutationFn: () =>
      existing ? api(`/suppliers/${existing.id}`, { method: "PUT", json: form }) : api("/suppliers", { method: "POST", json: form }),
    onSuccess: done,
    onError,
  });
  const del = useMutation({ mutationFn: () => api(`/suppliers/${existing!.id}`, { method: "DELETE" }), onSuccess: done, onError });

  return (
    <Modal open={editing !== null} title={existing ? `Edit ${existing.name}` : "Add supplier"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Supplier name">{(id) => <Input id={id} value={form.name} onChange={set("name")} required maxLength={120} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person">{(id) => <Input id={id} value={form.contact_person} onChange={set("contact_person")} maxLength={120} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={form.phone} onChange={set("phone")} maxLength={40} />}</Field>
        </div>
        <Field label="Email">{(id) => <Input id={id} type="email" value={form.email} onChange={set("email")} maxLength={120} />}</Field>
        <Field label="Address">{(id) => <Input id={id} value={form.address} onChange={set("address")} maxLength={300} />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} value={form.notes} onChange={set("notes")} placeholder="Delivery days, credit terms…" />}</Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-between gap-2">
          {existing ? (
            <Button type="button" variant="ghost" busy={del.isPending} onClick={() => del.mutate()}>
              <Trash2 className="size-4" aria-hidden /> Delete
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" busy={save.isPending}>
            {existing ? "Save changes" : "Add supplier"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
