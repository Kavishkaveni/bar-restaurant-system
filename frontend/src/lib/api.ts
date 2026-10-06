import { readJSON, remove, writeJSON } from "./storage";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKENS_KEY = "brs.tokens";

type Tokens = { access_token: string; refresh_token: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const tokens = {
  get: () => readJSON<Tokens>(TOKENS_KEY),
  set: (t: Tokens) => writeJSON(TOKENS_KEY, { access_token: t.access_token, refresh_token: t.refresh_token }),
  clear: () => remove(TOKENS_KEY),
};

// Called when the session can no longer be refreshed; AuthProvider sets it.
let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

// One refresh at a time, shared by every request that hit a 401 together.
let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const current = tokens.get();
  if (!current) return false;
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });
  if (!res.ok) return false;
  tokens.set(await res.json());
  return true;
}

function messageFrom(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{loc, msg}, ...]
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) => {
        const field = d.loc?.filter((p) => p !== "body").join(".");
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join("; ");
  }
  return status >= 500 ? "Server error. Try again in a moment." : `Request failed (${status})`;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;

  const send = () => {
    const t = tokens.get();
    return fetch(`${BASE}/api${path}`, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(t ? { Authorization: `Bearer ${t.access_token}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check that the backend is running and the internet is connected.");
  }

  const isLoginCall = ["/auth/login", "/auth/pin-login", "/auth/refresh"].includes(path);
  if (res.status === 401 && tokens.get() && !isLoginCall) {
    refreshing ??= refreshTokens().finally(() => (refreshing = null));
    if (await refreshing) {
      res = await send();
    } else {
      tokens.clear();
      onSessionExpired();
    }
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status));
  return body as T;
}
