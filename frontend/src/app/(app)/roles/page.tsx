"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { Guard } from "@/components/Guard";
import { Button, ErrorText, PageHeader, Panel, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { Role } from "@/lib/types";

// Groups follow the permission name prefix.
const GROUP_LABELS: Record<string, string> = {
  pos: "Billing",
  bar: "Bar",
  stock: "Stock",
  catalogue: "Items and recipes",
  purchasing: "Purchasing",
  rooms: "Rooms",
  kitchen: "Kitchen",
  expenses: "Expenses",
  dashboard: "Dashboard",
  ai: "AI",
  users: "Admin",
  settings: "Admin",
  audit: "Admin",
};

export default function RolesPage() {
  return (
    <Guard anyOf={["users.manage"]}>
      <Roles />
    </Guard>
  );
}

function Roles() {
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/roles") });
  const catalogue = useQuery({ queryKey: ["permissions"], queryFn: () => api<Record<string, string>>("/permissions") });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedId === null && roles.data?.length) setSelectedId(roles.data[1]?.id ?? roles.data[0].id);
  }, [roles.data, selectedId]);

  if (roles.isLoading || catalogue.isLoading) return <Spinner />;
  if (roles.error || catalogue.error) return <ErrorText>Could not load roles.</ErrorText>;

  const selected = roles.data!.find((r) => r.id === selectedId);

  return (
    <>
      <PageHeader title="Roles" description="Choose what each role can do. Changes apply to everyone with that role straight away." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <Panel className="h-fit p-2">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {roles.data!.map((r) => (
              <li key={r.id} className="shrink-0">
                <button
                  onClick={() => setSelectedId(r.id)}
                  className={clsx(
                    "w-full rounded-lg px-3 py-2 text-left text-sm font-medium",
                    r.id === selectedId ? "bg-bottle-900 text-white" : "hover:bg-ground",
                  )}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        {selected && <RoleEditor key={selected.id} role={selected} catalogue={catalogue.data!} />}
      </div>
    </>
  );
}

function RoleEditor({ role, catalogue }: { role: Role; catalogue: Record<string, string> }) {
  const qc = useQueryClient();
  const locked = role.name === "owner";
  const [chosen, setChosen] = useState(new Set(locked ? Object.keys(catalogue) : role.permission_names));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api<Role>(`/roles/${role.id}/permissions`, { method: "PUT", json: { permissions: [...chosen] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setSaved(true);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  const groups = new Map<string, string[]>();
  for (const key of Object.keys(catalogue)) {
    const label = GROUP_LABELS[key.split(".")[0]] ?? "Other";
    groups.set(label, [...(groups.get(label) ?? []), key]);
  }

  const dirty =
    !locked &&
    (chosen.size !== role.permission_names.length || role.permission_names.some((p) => !chosen.has(p)));

  function toggle(key: string) {
    setSaved(false);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">{role.label}</h2>
        {locked && (
          <span className="flex items-center gap-1.5 text-sm text-ink-soft">
            <Lock className="size-4" aria-hidden /> Always has every permission
          </span>
        )}
      </div>
      <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
        {[...groups.entries()].map(([label, keys]) => (
          <fieldset key={label}>
            <legend className="mb-2 text-sm font-semibold">{label}</legend>
            <div className="space-y-2">
              {keys.map((key) => (
                <label key={key} className={clsx("flex items-start gap-2.5 text-sm", locked && "opacity-70")}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-amber-500"
                    checked={chosen.has(key)}
                    disabled={locked}
                    onChange={() => toggle(key)}
                  />
                  {catalogue[key]}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {!locked && (
        <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-4">
          <ErrorText>{error}</ErrorText>
          {saved && !dirty && <span className="text-sm text-ok">Saved</span>}
          <Button onClick={() => save.mutate()} disabled={!dirty} busy={save.isPending}>
            Save permissions
          </Button>
        </div>
      )}
    </Panel>
  );
}
