"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Search } from "lucide-react";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import { Badge, Button, ErrorText, Field, Input, Modal, PageHeader, Panel, Select, Spinner, formatDateTime } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Role, User } from "@/lib/types";

export default function UsersPage() {
  return (
    <Guard anyOf={["users.manage"]}>
      <Users />
    </Guard>
  );
}

function Users() {
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<User | "new" | null>(null);

  const users = useQuery({
    queryKey: ["users", showInactive],
    queryFn: () => api<User[]>(`/users?include_inactive=${showInactive}`),
  });

  const term = q.trim().toLowerCase();
  const list = (users.data ?? []).filter(
    (u) => !term || u.name.toLowerCase().includes(term) || u.username.includes(term),
  );

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone who logs in. Give counter staff a 4-digit PIN so they can switch quickly on a shared screen."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Add staff
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <Input placeholder="Search by name or username" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Search staff" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-amber-500" />
          Show deactivated
        </label>
      </div>

      {users.isLoading ? (
        <Spinner />
      ) : users.error ? (
        <ErrorText>{(users.error as Error).message}</ErrorText>
      ) : list.length === 0 ? (
        <Panel className="px-6 py-12 text-center text-sm text-ink-soft">
          {term ? "No staff match that search." : "No staff yet. Add your first staff member."}
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          {/* Table on wide screens */}
          <table className="hidden w-full text-sm md:table">
            <thead className="border-b border-line bg-ground text-left text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">PIN</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((u) => (
                <tr key={u.id} className={u.is_active ? "" : "opacity-60"}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-ink-soft">@{u.username}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{u.role.label}</Badge> {!u.is_active && <Badge tone="off">Deactivated</Badge>}
                  </td>
                  <td className="px-4 py-3">{u.has_pin ? <Badge tone="ok">Set</Badge> : <span className="text-ink-soft">None</span>}</td>
                  <td className="px-4 py-3 text-ink-soft tabular">{formatDateTime(u.last_login_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                      <Pencil className="size-4" aria-hidden /> Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* List on phones */}
          <ul className="divide-y divide-line md:hidden">
            {list.map((u) => (
              <li key={u.id}>
                <button onClick={() => setEditing(u)} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${u.is_active ? "" : "opacity-60"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{u.name}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Badge>{u.role.label}</Badge>
                      {u.has_pin && <Badge tone="ok">PIN</Badge>}
                      {!u.is_active && <Badge tone="off">Deactivated</Badge>}
                    </span>
                  </span>
                  <Pencil className="size-4 text-ink-soft" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <UserForm key={editing === "new" ? "new" : editing?.id ?? "none"} editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function UserForm({ editing, onClose }: { editing: User | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isNew = editing === "new";
  const existing = isNew ? null : editing;

  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/roles") });
  const [name, setName] = useState(existing?.name ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [roleId, setRoleId] = useState<number | "">(existing?.role.id ?? "");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      if (isNew) {
        return api<User>("/users", {
          method: "POST",
          json: { name, username, password, role_id: roleId, ...(pin ? { pin } : {}) },
        });
      }
      return api<User>(`/users/${existing!.id}`, {
        method: "PATCH",
        json: { name, role_id: roleId, ...(password ? { password } : {}), ...(pin ? { pin } : {}) },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  const patch = useMutation({
    mutationFn: (body: object) => api<User>(`/users/${existing!.id}`, { method: "PATCH", json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pin && !/^\d{4}$/.test(pin)) return setError("PIN must be exactly 4 digits.");
    save.mutate();
  }

  const isMe = existing?.id === me?.id;

  return (
    <Modal open={editing !== null} title={isNew ? "Add staff" : `Edit ${existing?.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Username" hint={isNew ? "Letters, numbers, dots, dashes. Used to log in with a password." : undefined}>
          {(id) => (
            <Input
              id={id}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              disabled={!isNew}
              autoCapitalize="none"
              pattern="[a-zA-Z0-9_.\-]+"
            />
          )}
        </Field>
        <Field label="Role">
          {(id) => (
            <Select id={id} value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} required>
              <option value="" disabled>
                Choose a role
              </option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={isNew ? "Password" : "New password"} hint={isNew ? "At least 8 characters." : "Leave empty to keep the current password."}>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={isNew} minLength={8} />
          )}
        </Field>
        <Field label={existing?.has_pin ? "New PIN" : "PIN"} hint={existing?.has_pin ? "Leave empty to keep the current PIN." : "Optional. 4 digits for quick login on the counter."}>
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="tabular tracking-[0.5em]"
            />
          )}
        </Field>

        <ErrorText>{error}</ErrorText>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
          {existing && !isMe ? (
            <div className="flex flex-wrap gap-2">
              {existing.has_pin && (
                <Button type="button" variant="secondary" busy={patch.isPending} onClick={() => patch.mutate({ remove_pin: true })}>
                  <KeyRound className="size-4" aria-hidden /> Remove PIN
                </Button>
              )}
              <Button
                type="button"
                variant={existing.is_active ? "danger" : "secondary"}
                busy={patch.isPending}
                onClick={() => patch.mutate({ is_active: !existing.is_active })}
              >
                {existing.is_active ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          ) : (
            <span />
          )}
          <Button type="submit" busy={save.isPending}>
            {isNew ? "Add staff" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
