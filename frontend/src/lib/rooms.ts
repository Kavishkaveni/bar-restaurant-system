import type { BookingStatus, FolioMethod, Housekeeping, IdType } from "./types";

export const STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Booked",
  checked_in: "In house",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const STATUS_TONE: Record<
  BookingStatus,
  "neutral" | "ok" | "warn" | "off"
> = {
  booked: "warn",
  checked_in: "ok",
  checked_out: "neutral",
  cancelled: "off",
  no_show: "off",
};

export const HOUSEKEEPING_LABEL: Record<Housekeeping, string> = {
  clean: "Clean",
  dirty: "Needs cleaning",
  maintenance: "Maintenance",
};

export const ID_LABEL: Record<IdType, string> = {
  nic: "NIC",
  passport: "Passport",
  driving_licence: "Driving licence",
  other: "Other ID",
};

export const FOLIO_METHODS: { key: FolioMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "qr", label: "QR" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-06" for a Date in the browser's (the hotel's) local time. */
export function dateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "14:30" in local time. */
export function timeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date + "HH:MM" → ISO string with the right offset for the API. */
export function toISO(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return dateInput(new Date(y, m - 1, d + days));
}

export function nightsBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

/** "Tue 6 Oct, 14:00" */
export function stayTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "6 Oct" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
