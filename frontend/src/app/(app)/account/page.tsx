"use client";

import { useState } from "react";

import { Badge, Button, ErrorText, Field, Input, PageHeader, Panel } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { LoginResponse } from "@/lib/types";

export default function AccountPage() {
  const { user, permissions, apply } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      const res = await api<LoginResponse>("/auth/change-password", {
        method: "POST",
        json: { current_password: current, new_password: next },
      });
      apply(res);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <>
      <PageHeader title="My account" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-semibold">{user.name}</h2>
          <p className="text-sm text-ink-soft">@{user.username}</p>
          <div className="mt-3">
            <Badge>{user.role.label}</Badge>
          </div>
          <p className="mt-4 text-sm text-ink-soft">You can use {permissions.length} features with this role.</p>
        </Panel>

        <Panel className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <h2 className="font-semibold">Change password</h2>
            <Field label="Current password">
              {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}
            </Field>
            <Field label="New password" hint="At least 8 characters. Other devices will be logged out.">
              {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />}
            </Field>
            <Field label="Confirm new password">
              {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
            </Field>
            <ErrorText>{error}</ErrorText>
            {done && <p className="text-sm text-ok">Password changed.</p>}
            <Button type="submit" busy={busy}>
              Change password
            </Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
