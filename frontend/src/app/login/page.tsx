"use client";

import clsx from "clsx";
import { ChevronLeft, Delete, Wine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, ErrorText, Field, Input } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cachedStaff, useAuth } from "@/lib/auth";
import type { StaffTile } from "@/lib/types";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [staff, setStaff] = useState<StaffTile[]>([]);
  const [mode, setMode] = useState<"pin" | "password">("password");

  useEffect(() => {
    const list = cachedStaff();
    setStaff(list);
    if (list.length) setMode("pin");
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace("/home");
  }, [user, loading, router]);

  return (
    <main className="flex min-h-dvh flex-col bg-bottle-900 text-white">
      <header className="flex items-center gap-2 px-6 pt-6">
        <Wine className="size-6 text-amber-400" aria-hidden />
        <span className="text-lg font-semibold">Bar &amp; Restaurant</span>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          {mode === "pin" ? <PinLogin staff={staff} /> : <PasswordLogin />}

          <div className="mt-6 text-center">
            {mode === "pin" ? (
              <button onClick={() => setMode("password")} className="text-sm text-bottle-200 underline-offset-4 hover:underline">
                Log in with username and password
              </button>
            ) : (
              staff.length > 0 && (
                <button onClick={() => setMode("pin")} className="text-sm text-bottle-200 underline-offset-4 hover:underline">
                  Switch staff with a PIN
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function PasswordLogin() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl bg-surface p-6 text-ink shadow-xl">
      <h1 className="text-xl font-bold">Log in</h1>
      <Field label="Username">
        {(id) => (
          <Input id={id} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
        )}
      </Field>
      <Field label="Password">
        {(id) => (
          <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        )}
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" size="lg" busy={busy} className="w-full">
        Log in
      </Button>
    </form>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

function PinLogin({ staff }: { staff: StaffTile[] }) {
  const { pinLogin } = useAuth();
  const [who, setWho] = useState<StaffTile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      if (!who) return;
      setBusy(true);
      setError("");
      try {
        await pinLogin(who.id, value);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Login failed");
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [who, pinLogin],
  );

  const press = useCallback(
    (key: string) => {
      if (busy) return;
      if (key === "del") return setPin((p) => p.slice(0, -1));
      setPin((p) => (p.length >= 4 ? p : p + key));
    },
    [busy],
  );

  // Submit as soon as the fourth digit is in.
  useEffect(() => {
    if (pin.length === 4 && !busy) submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Number keys work on a counter PC with a keyboard.
  useEffect(() => {
    if (!who) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === "Backspace") press("del");
      if (e.key === "Escape") setWho(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [who, press]);

  if (!who) {
    return (
      <div>
        <h1 className="mb-4 text-center text-xl font-bold">Who is working?</h1>
        <ul className="grid grid-cols-2 gap-3">
          {staff.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  setWho(s);
                  setPin("");
                  setError("");
                }}
                className="flex w-full flex-col items-start rounded-xl bg-bottle-800 px-4 py-3 text-left transition-colors hover:bg-bottle-700"
              >
                <span className="font-semibold">{s.name}</span>
                <span className="text-sm text-bottle-200">{s.role.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setWho(null)} className="mb-4 inline-flex items-center gap-1 text-sm text-bottle-200 hover:text-white">
        <ChevronLeft className="size-4" aria-hidden /> Not {who.name}?
      </button>
      <h1 className="text-center text-xl font-bold">Hi {who.name.split(" ")[0]}, enter your PIN</h1>

      <div className="my-6 flex justify-center gap-4" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={clsx(
              "size-4 rounded-full border-2 border-amber-400 transition-colors",
              i < pin.length ? "bg-amber-400" : "bg-transparent",
            )}
          />
        ))}
      </div>

      {error && <p role="alert" className="mb-4 text-center text-sm text-amber-100">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              onClick={() => press(k)}
              disabled={busy}
              aria-label={k === "del" ? "Delete last digit" : k}
              className="flex h-16 items-center justify-center rounded-2xl bg-bottle-800 text-2xl font-semibold tabular transition-colors hover:bg-bottle-700 active:bg-amber-500 active:text-bottle-950 disabled:opacity-50"
            >
              {k === "del" ? <Delete className="size-6" aria-hidden /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
