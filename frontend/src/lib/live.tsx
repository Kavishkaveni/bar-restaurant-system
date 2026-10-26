"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";

import { api, tokens } from "./api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** What to refresh when the server says a part of the app changed. */
const REFRESH: Record<string, string[][]> = {
  orders: [
    ["orders"],
    ["tables"],
    ["kitchen"],
    ["dashboard"],
    ["shift"],
    ["pos-menu"],
    ["report"],
    ["items"],
    ["in-house"],
    ["open-bottles"],
  ],
  kitchen: [["kitchen"], ["orders"], ["dashboard"]],
  rooms: [
    ["room-board"],
    ["bookings"],
    ["booking"],
    ["in-house"],
    ["dashboard"],
    ["shift"],
    ["report"],
  ],
  stock: [
    ["items"],
    ["pos-menu"],
    ["open-bottles"],
    ["dashboard"],
    ["stock-report"],
  ],
  money: [["shift"], ["shifts"], ["expenses"], ["dashboard"], ["report"]],
  settings: [["settings"]],
};

const LiveContext = createContext(false);

/** Keeps a WebSocket open to the server and refreshes screens when something changes. */
export function LiveUpdates({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const access = tokens.get()?.access_token;
      if (!access || stopped) return;
      ws = new WebSocket(
        `${BASE.replace(/^http/, "ws")}/api/live?token=${encodeURIComponent(access)}`,
      );
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        try {
          const { topic } = JSON.parse(e.data) as { topic: string };
          for (const key of REFRESH[topic] ?? [])
            qc.invalidateQueries({ queryKey: key });
        } catch {
          // ignore anything that isn't ours
        }
      };
      ws.onclose = async (e) => {
        setConnected(false);
        if (stopped) return;
        if (e.code === 4401) {
          // The login token expired; any API call refreshes it.
          await api("/auth/me").catch(() => undefined);
        }
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 1000 * 2 ** (retry - 1)); // 1s, 2s, 4s … up to a minute
      };
    };

    connect();
    // Phones drop sockets when the screen sleeps: reconnect when the page is shown again.
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        (!ws || ws.readyState === WebSocket.CLOSED)
      ) {
        clearTimeout(timer);
        retry = 0;
        connect();
        qc.invalidateQueries();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [qc]);

  return (
    <LiveContext.Provider value={connected}>{children}</LiveContext.Provider>
  );
}

/** True while live updates are connected. */
export function useLive(): boolean {
  return useContext(LiveContext);
}