"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, ErrorText, Field, Input, Modal, Panel, Select, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Category, Module } from "@/lib/types";

export const MODULES: { key: Module; label: string; hint: string }[] = [
  { key: "bar", label: "Bar", hint: "Whisky, arrack, beer, wine" },
  { key: "sundry", label: "Sundries", hint: "Soft drinks, cigarettes, snacks" },
  { key: "food", label: "Kitchen", hint: "Rice, meat, vegetables, oil, spices" },
  { key: "other", label: "Other", hint: "Gas, cleaning, supplies" },
];

export function CategoriesTab() {
  const { can } = useAuth();
  const manage = can("catalogue.manage");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });

  if (categories.isLoading) return <Spinner />;
  const list = categories.data ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-soft">Group items so they&apos;re easy to find on the POS and in reports.</p>
        {manage && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Add category
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <Panel className="px-6 py-12 text-center">
          <p className="font-semibold">No categories yet</p>
          <p className="mt-1 text-sm text-ink-soft">Start with a few, like Whisky, Beer, Soft drinks, Cigarettes and Rice.</p>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {MODULES.map((m) => {
            const rows = list.filter((c) => c.module === m.key);
            if (!rows.length) return null;
            return (
              <Panel key={m.key}>
                <h3 className="border-b border-line px-4 py-3 font-semibold">{m.label}</h3>
                <ul className="divide-y divide-line">
                  {rows.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="flex-1 font-medium">{c.name}</span>
                      <span className="text-ink-soft tabular">
                        {c.item_count} item{c.item_count === 1 ? "" : "s"}
                      </span>
                      {manage && (
                        <Button variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}

      <CategoryForm key={editing === "new" ? "new" : editing?.id ?? "none"} editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function CategoryForm({ editing, onClose }: { editing: Category | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = editing === "new" ? null : editing;
  const [name, setName] = useState(existing?.name ?? "");
  const [module, setModule] = useState<Module>(existing?.module ?? "bar");
  const [error, setError] = useState("");

  const done = () => {
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["items"] });
    onClose();
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not save");

  const save = useMutation({
    mutationFn: () =>
      existing
        ? api(`/categories/${existing.id}`, { method: "PATCH", json: { name, module } })
        : api("/categories", { method: "POST", json: { name, module } }),
    onSuccess: done,
    onError,
  });
  const del = useMutation({ mutationFn: () => api(`/categories/${existing!.id}`, { method: "DELETE" }), onSuccess: done, onError });

  return (
    <Modal open={editing !== null} title={existing ? "Edit category" : "Add category"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />}</Field>
        <Field label="Section" hint={MODULES.find((m) => m.key === module)?.hint}>
          {(id) => (
            <Select id={id} value={module} onChange={(e) => setModule(e.target.value as Module)}>
              {MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
            {existing ? "Save changes" : "Add category"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
