"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Delete, ShieldCheck } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

import { Button, ErrorText, Field, Input, Modal } from "@/components/ui";

import { ApiError, api } from "./api";
import { useAuth } from "./auth";
import type { Approval, StaffTile } from "./types";

type Request = { title: string; askReason?: boolean };
type Result = { approval: Approval; reason: string } | null;

type Ctx = {
  /**
   * Run an action; if the server says a manager must approve (HTTP 428),
   * ask for a manager's PIN and run it again with the approval attached.
   */
  withApproval: <T>(run: (approval?: Approval, reason?: string) => Promise<T>, req: Request) => Promise<T | undefined>;
};

const ApprovalContext = createContext<Ctx | null>(null);

export function ApprovalProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [lastError, setLastError] = useState("");
  const resolver = useRef<((r: Result) => void) | null>(null);

  const ask = useCallback((r: Request) => {
    setReq(r);
    return new Promise<Result>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (r: Result) => {
    resolver.current?.(r);
    resolver.current = null;
    setReq(null);
  };

  const withApproval: Ctx["withApproval"] = useCallback(
    async (run, r) => {
      try {
        return await run();
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 428) throw e;
        // Ask until approved, cancelled, or a non-PIN error.
        for (;;) {
          const answer = await ask(r);
          if (!answer) return undefined;
          try {
            return await run(answer.approval, answer.reason);
          } catch (err) {
            if (err instanceof ApiError && [401, 403, 423].includes(err.status)) {
              setLastError(err.message);
              continue;
            }
            throw err;
          }
        }
      }
    },
    [ask],
  );

  return (
    <ApprovalContext.Provider value={{ withApproval }}>
      {children}
      <ApproveDialog
        request={req}
        error={lastError}
        onDone={(r) => {
          setLastError("");
          finish(r);
        }}
      />
    </ApprovalContext.Provider>
  );
}

export function useApproval(): Ctx {
  const ctx = useContext(ApprovalContext);
  if (!ctx) throw new Error("useApproval must be used inside ApprovalProvider");
  return ctx;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

function ApproveDialog({ request, error, onDone }: { request: Request | null; error: string; onDone: (r: Result) => void }) {
  const staff = useQuery({
    queryKey: ["staff-tiles"],
    queryFn: () => api<StaffTile[]>("/auth/staff"),
    enabled: request !== null,
  });
  const [who, setWho] = useState<StaffTile | null>(null);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  const { user } = useAuth();
  // The person asking can't approve their own request.
  const managersFirst = (staff.data ?? []).filter((s) => s.id !== user?.id).sort((a, b) => rank(a) - rank(b));

  function submit(value: string) {
    if (!who) return;
    if (request?.askReason && reason.trim().length < 2) {
      setLocalError("Say why, e.g. customer changed their mind.");
      setPin("");
      return;
    }
    setLocalError("");
    onDone({ approval: { user_id: who.id, pin: value }, reason: reason.trim() });
    setPin("");
  }

  function press(k: string) {
    if (k === "del") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) submit(next);
  }

  return (
    <Modal
      open={request !== null}
      title="Manager approval"
      onClose={() => {
        setWho(null);
        setPin("");
        setReason("");
        onDone(null);
      }}
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            <span className="font-semibold">{request?.title}</span> needs a manager. Ask a manager to choose their name and enter their PIN.
          </span>
        </p>

        {request?.askReason && (
          <Field label="Reason">
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed their mind" maxLength={200} />}
          </Field>
        )}

        <div className="flex flex-wrap gap-2">
          {managersFirst.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setWho(s);
                setPin("");
              }}
              className={clsx(
                "rounded-lg border px-3 py-2 text-left text-sm",
                who?.id === s.id ? "border-amber-500 bg-amber-100" : "border-line hover:bg-ground",
              )}
            >
              <span className="block font-medium">{s.name}</span>
              <span className="block text-xs text-ink-soft">{s.role.label}</span>
            </button>
          ))}
          {staff.data?.length === 0 && <p className="text-sm text-ink-soft">No one has a PIN yet. Set a PIN for a manager in Staff.</p>}
        </div>

        {who && (
          <>
            <div className="flex justify-center gap-3" aria-label={`${pin.length} of 4 digits entered`}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={clsx("size-3.5 rounded-full border-2 border-bottle-800", i < pin.length && "bg-bottle-800")} />
              ))}
            </div>
            <div className="mx-auto grid max-w-64 grid-cols-3 gap-2">
              {KEYS.map((k, i) =>
                k === "" ? (
                  <span key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => press(k)}
                    aria-label={k === "del" ? "Delete last digit" : k}
                    className="flex h-12 items-center justify-center rounded-xl bg-ground text-xl font-semibold tabular hover:bg-bottle-100"
                  >
                    {k === "del" ? <Delete className="size-5" aria-hidden /> : k}
                  </button>
                ),
              )}
            </div>
          </>
        )}
        <ErrorText>{localError || error}</ErrorText>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => onDone(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function rank(s: StaffTile): number {
  return s.role.name === "owner" ? 0 : s.role.name === "manager" ? 1 : 2;
}
