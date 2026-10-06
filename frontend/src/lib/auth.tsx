"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, setSessionExpiredHandler, tokens } from "./api";
import { readJSON, writeJSON } from "./storage";
import type { LoginResponse, StaffTile, User } from "./types";

const STAFF_KEY = "brs.staff";

type AuthState = {
  user: User | null;
  permissions: string[];
  loading: boolean;
  can: (...perms: string[]) => boolean;
  login: (username: string, password: string) => Promise<void>;
  pinLogin: (userId: number, pin: string) => Promise<void>;
  logout: () => void;
  apply: (res: LoginResponse) => void;
};

const AuthContext = createContext<AuthState | null>(null);

/** Staff who can switch in with a PIN on this device. Cached so the PIN
 *  screen works after logout. */
export function cachedStaff(): StaffTile[] {
  return readJSON<StaffTile[]>(STAFF_KEY) ?? [];
}

async function refreshStaffCache() {
  try {
    writeJSON(STAFF_KEY, await api<StaffTile[]>("/auth/staff"));
  } catch {
    /* keep the old list */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    tokens.clear();
    setUser(null);
    setPermissions([]);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      clear();
      router.replace("/login");
    });
    if (!tokens.get()) {
      setLoading(false);
      return;
    }
    api<{ user: User; permissions: string[] }>("/auth/me")
      .then((me) => {
        setUser(me.user);
        setPermissions(me.permissions);
        refreshStaffCache();
      })
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, [clear, router]);

  const apply = useCallback(
    (res: LoginResponse) => {
      queryClient.clear();
      tokens.set(res);
      setUser(res.user);
      setPermissions(res.permissions);
      refreshStaffCache();
    },
    [queryClient],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      permissions,
      loading,
      can: (...perms) => perms.every((p) => permissions.includes(p)),
      login: async (username, password) =>
        apply(await api<LoginResponse>("/auth/login", { method: "POST", json: { username, password } })),
      pinLogin: async (userId, pin) =>
        apply(await api<LoginResponse>("/auth/pin-login", { method: "POST", json: { user_id: userId, pin } })),
      logout: () => {
        clear();
        router.replace("/login");
      },
      apply,
    }),
    [user, permissions, loading, apply, clear, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
