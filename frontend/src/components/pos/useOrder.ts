"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useApproval } from "@/lib/approval";
import type { Approval, Order } from "@/lib/types";

/** Loads one bill and runs actions on it, asking for manager approval when needed. */
export function useOrder(id: number) {
  const qc = useQueryClient();
  const { withApproval } = useApproval();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const query = useQuery({ queryKey: ["orders", id], queryFn: () => api<Order>(`/orders/${id}`) });

  const put = useCallback(
    (o: Order) => {
      qc.setQueryData(["orders", o.id], o);
      qc.invalidateQueries({ queryKey: ["orders", "open"] });
      qc.invalidateQueries({ queryKey: ["orders", "bills"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    [qc],
  );

  /** Run an API call that returns the updated bill. */
  const act = useCallback(
    async (
      call: (approval?: Approval, reason?: string) => Promise<Order>,
      approvalTitle?: string,
      askReason = false,
    ): Promise<Order | undefined> => {
      setBusy(true);
      setError("");
      try {
        const o = approvalTitle ? await withApproval(call, { title: approvalTitle, askReason }) : await call();
        if (o) put(o);
        return o;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something went wrong");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [withApproval, put],
  );

  const post = (path: string, json?: unknown) => api<Order>(`/orders/${id}${path}`, { method: "POST", json: json ?? {} });

  return { query, order: query.data, act, post, put, busy, error, setError };
}