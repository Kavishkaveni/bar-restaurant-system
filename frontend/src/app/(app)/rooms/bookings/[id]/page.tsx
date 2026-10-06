"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  DoorClosed,
  DoorOpen,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Utensils,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Guard } from "@/components/Guard";
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useApproval } from "@/lib/approval";
import { useMoney, useSettings } from "@/lib/money";
import {
  FOLIO_METHODS,
  ID_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  addDays,
  dateInput,
  nightsBetween,
  stayTime,
  toISO,
} from "@/lib/rooms";
import type {
  Approval,
  Booking,
  FolioMethod,
  IdType,
  Order,
  Room,
} from "@/lib/types";

type Run = (approval?: Approval, reason?: string) => Promise<Booking>;
type Act = (run: Run, title?: string) => Promise<Booking | undefined>;

export default function BookingPage() {
  return (
    <Guard anyOf={["rooms.manage"]}>
      <BookingView />
    </Guard>
  );
}

function useBooking(id: string) {
  const qc = useQueryClient();
  const { withApproval } = useApproval();
  const query = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api<Booking>(`/bookings/${id}`),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act: Act = async (run, title = "Manager approval") => {
    setError("");
    setBusy(true);
    try {
      const b = await withApproval(run, { title });
      if (b) {
        qc.setQueryData(["booking", id], b);
        qc.invalidateQueries({ queryKey: ["room-board"] });
        qc.invalidateQueries({ queryKey: ["bookings"] });
      }
      return b;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { query, act, busy, error, setError };
}

type Dialog =
  "checkin" | "checkout" | "charge" | "payment" | "edit" | "cancel" | null;

function BookingView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const money = useMoney();
  const { query, act, busy, error, setError } = useBooking(id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [roomService, setRoomService] = useState(false);
  const b = query.data;

  if (query.isLoading) return <Spinner />;
  if (!b)
    return (
      <ErrorText>
        {query.error instanceof ApiError
          ? query.error.message
          : "Booking not found"}
      </ErrorText>
    );

  const f = b.folio;
  const live = b.status === "booked" || b.status === "checked_in";
  const close = () => {
    setDialog(null);
    setError("");
  };

  async function startRoomService() {
    setRoomService(true);
    try {
      const o = await api<Order>("/orders", {
        method: "POST",
        json: { type: "room", booking_id: b!.id },
      });
      router.push(`/pos/${o.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the order");
      setRoomService(false);
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Link
          href="/rooms"
          className="rounded-lg border border-line bg-surface p-2.5 hover:bg-ground"
          aria-label="Back to rooms"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">
              Room {b.room.number} · {b.guest_name}
            </h1>
            <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
          </div>
          <p className="text-sm text-ink-soft">
            {b.room.room_type.name} ·{" "}
            {b.stay_type === "short" ? "Short stay" : "Overnight"} · Booking #
            {b.id}
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {b.status === "booked" && (
          <Button size="lg" onClick={() => setDialog("checkin")}>
            <DoorOpen className="size-5" aria-hidden /> Check in
          </Button>
        )}
        {b.status === "checked_in" && (
          <>
            <Button size="lg" onClick={() => setDialog("checkout")}>
              <DoorClosed className="size-5" aria-hidden /> Check out
            </Button>
            <Button
              size="lg"
              variant="secondary"
              busy={roomService}
              onClick={startRoomService}
            >
              <Utensils className="size-5" aria-hidden /> Room service
            </Button>
          </>
        )}
        {live && (
          <>
            <Button variant="secondary" onClick={() => setDialog("payment")}>
              <Wallet className="size-4" aria-hidden /> Take payment
            </Button>
            <Button variant="secondary" onClick={() => setDialog("charge")}>
              <Plus className="size-4" aria-hidden /> Add charge
            </Button>
            <Button variant="secondary" onClick={() => setDialog("edit")}>
              <Pencil className="size-4" aria-hidden /> Change
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          onClick={() => window.open(`/print/booking/${b.id}`, "_blank")}
        >
          <Printer className="size-4" aria-hidden /> Print bill
        </Button>
        {b.status === "booked" && (
          <Button variant="ghost" onClick={() => setDialog("cancel")}>
            <Ban className="size-4" aria-hidden /> Cancel booking
          </Button>
        )}
      </div>
      {!dialog && <ErrorText>{error}</ErrorText>}

      {b.open_bills.length > 0 && (
        <Panel className="mb-4 border-amber-500 p-4 text-sm">
          Room service not yet on the bill:{" "}
          {b.open_bills.map((o) => (
            <Link
              key={o.id}
              href={`/pos/${o.id}`}
              className="mr-3 font-semibold underline underline-offset-4"
            >
              Bill #{o.id} ({money(o.total)})
            </Link>
          ))}
          <span className="text-ink-soft">
            Open it and choose &quot;Charge to room&quot;.
          </span>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Panel className="p-5">
          <h2 className="mb-3 font-semibold">Stay</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-soft">Arrival</dt>
            <dd>
              {stayTime(b.checked_in_at ?? b.arrival)}
              {b.checked_in_at ? "" : " (planned)"}
            </dd>
            <dt className="text-ink-soft">Departure</dt>
            <dd>
              {stayTime(b.checked_out_at ?? b.departure)}
              {b.checked_out_at ? "" : " (planned)"}
            </dd>
            <dt className="text-ink-soft">Price</dt>
            <dd className="tabular">
              {money(b.rate)}{" "}
              {b.stay_type === "short"
                ? `for ${b.block_hours} hours${b.extra_hour_rate ? `, ${money(b.extra_hour_rate)} each extra hour` : ""}`
                : "per night"}
            </dd>
            <dt className="text-ink-soft">Guests</dt>
            <dd>
              {b.adults} {b.adults === 1 ? "adult" : "adults"}
              {b.children > 0 &&
                `, ${b.children} ${b.children === 1 ? "child" : "children"}`}
            </dd>
          </dl>
          <h2 className="mt-5 mb-3 font-semibold">Guest</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-soft">Name</dt>
            <dd>{b.guest_name}</dd>
            <dt className="text-ink-soft">Phone</dt>
            <dd>
              {b.phone ? (
                <a
                  href={`tel:${b.phone}`}
                  className="underline underline-offset-4"
                >
                  {b.phone}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-ink-soft">{ID_LABEL[b.id_type]}</dt>
            <dd>
              {b.id_number || (
                <span className="text-amber-600">Not entered yet</span>
              )}
            </dd>
            {b.address && (
              <>
                <dt className="text-ink-soft">Address</dt>
                <dd>{b.address}</dd>
              </>
            )}
            {b.vehicle_no && (
              <>
                <dt className="text-ink-soft">Vehicle</dt>
                <dd>{b.vehicle_no}</dd>
              </>
            )}
            {b.note && (
              <>
                <dt className="text-ink-soft">Note</dt>
                <dd className="whitespace-pre-line">{b.note}</dd>
              </>
            )}
            {b.cancel_reason && (
              <>
                <dt className="text-ink-soft">Reason</dt>
                <dd>{b.cancel_reason}</dd>
              </>
            )}
          </dl>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 font-semibold">Room bill</h2>
          <ul className="divide-y divide-line text-sm">
            {b.status !== "cancelled" && b.status !== "no_show" && (
              <BillRow
                label={`Room: ${f.units} ${f.unit_label}${f.units === 1 ? "" : "s"}`}
                sub={f.estimated ? "Estimate. Fixed at check-out." : undefined}
                amount={money(f.room_charge)}
              />
            )}
            {b.charges.map((c) => (
              <BillRow
                key={c.id}
                label={c.description}
                sub={
                  c.kind === "room_service"
                    ? "Tap to see the items"
                    : c.kind === "discount"
                      ? "Discount"
                      : undefined
                }
                amount={money(c.amount)}
                onRemove={
                  live && c.kind !== "room_service"
                    ? () =>
                        act(
                          (approval) =>
                            api<Booking>(
                              `/bookings/${b.id}/charges/${c.id}/remove`,
                              { method: "POST", json: { approval } },
                            ),
                          `Remove "${c.description}"`,
                        )
                    : undefined
                }
                link={c.order_id ? `/pos/${c.order_id}` : undefined}
              />
            ))}
            {f.tax > 0 && (
              <BillRow
                label={`Tax (${f.tax_percent}%)`}
                amount={money(f.tax)}
              />
            )}
            <li className="flex justify-between py-2.5 text-base font-bold">
              <span>Total</span>
              <span className="tabular">{money(f.total)}</span>
            </li>
            {b.payments.map((p) => (
              <BillRow
                key={p.id}
                label={`${p.kind === "refund" ? "Refund" : "Paid"}: ${FOLIO_METHODS.find((m) => m.key === p.method)?.label}${p.reference ? ` (${p.reference})` : ""}`}
                sub={stayTime(p.created_at)}
                amount={`${p.kind === "refund" ? "+" : "−"} ${money(p.amount)}`}
                muted
              />
            ))}
            <li
              className={clsx(
                "flex justify-between py-2.5 text-base font-bold",
                f.balance > 0 ? "text-ink" : "text-ok",
              )}
            >
              <span>{f.balance >= 0 ? "Balance to pay" : "To give back"}</span>
              <span className="tabular">{money(Math.abs(f.balance))}</span>
            </li>
          </ul>
        </Panel>
      </div>

      <CheckInDialog
        open={dialog === "checkin"}
        booking={b}
        act={act}
        busy={busy}
        error={error}
        onClose={close}
      />
      <CheckOutDialog
        open={dialog === "checkout"}
        booking={b}
        act={act}
        busy={busy}
        error={error}
        onClose={close}
      />
      <ChargeDialog
        open={dialog === "charge"}
        booking={b}
        act={act}
        busy={busy}
        error={error}
        onClose={close}
      />
      <PaymentDialog
        open={dialog === "payment"}
        booking={b}
        act={act}
        busy={busy}
        error={error}
        onClose={close}
      />
      <EditDialog
        open={dialog === "edit"}
        booking={b}
        act={act}
        busy={busy}
        error={error}
        onClose={close}
      />
      <CancelDialog
        open={dialog === "cancel"}
        booking={b}
        act={act}
        busy={busy}
        error={error}
        onClose={close}
      />
    </>
  );
}

function BillRow({
  label,
  sub,
  amount,
  muted,
  onRemove,
  link,
}: {
  label: string;
  sub?: string;
  amount: string;
  muted?: boolean;
  onRemove?: () => void;
  link?: string;
}) {
  return (
    <li
      className={clsx(
        "flex items-center gap-3 py-2.5",
        muted && "text-ink-soft",
      )}
    >
      <span className="min-w-0 flex-1">
        {link ? (
          <Link href={link} className="underline-offset-4 hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
        {sub && <span className="block text-xs text-ink-soft">{sub}</span>}
      </span>
      <span className="tabular">{amount}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="rounded p-1 text-ink-soft hover:bg-ground hover:text-danger"
          aria-label={`Remove ${label}`}
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}

type DialogProps = {
  open: boolean;
  booking: Booking;
  act: Act;
  busy: boolean;
  error: string;
  onClose: () => void;
};

function Footer({
  busy,
  label,
  onClose,
  danger,
}: {
  busy: boolean;
  label: string;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" busy={busy} variant={danger ? "danger" : "primary"}>
        {label}
      </Button>
    </div>
  );
}

function MethodSelect({
  value,
  onChange,
  label = "Paid by",
}: {
  value: FolioMethod;
  onChange: (m: FolioMethod) => void;
  label?: string;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as FolioMethod)}
        >
          {FOLIO_METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

// ---- Check in ------------------------------------------------------------------------

function CheckInDialog({
  open,
  booking: b,
  act,
  busy,
  error,
  onClose,
}: DialogProps) {
  return (
    <Modal open={open} title={`Check in ${b.guest_name}`} onClose={onClose}>
      {open && (
        <CheckInBody
          booking={b}
          act={act}
          busy={busy}
          error={error}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function CheckInBody({
  booking: b,
  act,
  busy,
  error,
  onClose,
}: Omit<DialogProps, "open">) {
  const [g, setG] = useState({
    guest_name: b.guest_name,
    phone: b.phone,
    id_type: b.id_type,
    id_number: b.id_number,
    address: b.address,
    vehicle_no: b.vehicle_no,
    adults: String(b.adults),
    children: String(b.children),
  });
  const set =
    (k: keyof typeof g) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setG((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act(() =>
          api<Booking>(`/bookings/${b.id}/check-in`, {
            method: "POST",
            json: {
              ...g,
              adults: Number(g.adults) || 1,
              children: Number(g.children) || 0,
            },
          }),
        );
        if (r) onClose();
      }}
    >
      <p className="text-sm text-ink-soft">
        Check the guest&apos;s ID and complete the details.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={g.guest_name}
              onChange={set("guest_name")}
              required
            />
          )}
        </Field>
        <Field label="Phone">
          {(id) => (
            <Input
              id={id}
              type="tel"
              value={g.phone}
              onChange={set("phone")}
              required
            />
          )}
        </Field>
        <Field label="ID type">
          {(id) => (
            <Select id={id} value={g.id_type} onChange={set("id_type")}>
              {(Object.keys(ID_LABEL) as IdType[]).map((k) => (
                <option key={k} value={k}>
                  {ID_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`${ID_LABEL[g.id_type]} number`}>
          {(id) => (
            <Input
              id={id}
              value={g.id_number}
              onChange={set("id_number")}
              required
            />
          )}
        </Field>
        <Field label="Adults">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              value={g.adults}
              onChange={set("adults")}
            />
          )}
        </Field>
        <Field label="Children">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={g.children}
              onChange={set("children")}
            />
          )}
        </Field>
        <Field label="Address (optional)">
          {(id) => (
            <Input id={id} value={g.address} onChange={set("address")} />
          )}
        </Field>
        <Field label="Vehicle number (optional)">
          {(id) => (
            <Input id={id} value={g.vehicle_no} onChange={set("vehicle_no")} />
          )}
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <Footer busy={busy} label="Check in" onClose={onClose} />
    </form>
  );
}

// ---- Check out -----------------------------------------------------------------------

function CheckOutDialog({
  open,
  booking: b,
  act,
  busy,
  error,
  onClose,
}: DialogProps) {
  return (
    <Modal
      open={open}
      title={`Check out Room ${b.room.number}`}
      onClose={onClose}
    >
      {open && (
        <CheckOutBody
          booking={b}
          act={act}
          busy={busy}
          error={error}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function CheckOutBody({
  booking: b,
  act,
  busy,
  error,
  onClose,
}: Omit<DialogProps, "open">) {
  const money = useMoney();
  const settings = useSettings().data;
  const f = b.folio;
  const nowUnits = estimateUnits(b, settings?.timezone);
  const [units, setUnits] = useState(String(nowUnits));
  const [method, setMethod] = useState<FolioMethod>("cash");
  const [reference, setReference] = useState("");

  const u = Math.max(0.5, Number(units) || nowUnits);
  const room =
    b.stay_type === "short"
      ? b.rate + Math.max(0, u - b.block_hours) * b.extra_hour_rate
      : b.rate * u;
  const taxable = Math.max(0, room + f.extras + f.discounts);
  const tax = Math.round(taxable * f.tax_percent) / 100;
  const total = taxable + tax + f.room_service;
  const balance = Math.round((total - f.paid) * 100) / 100;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act(
          (approval) =>
            api<Booking>(`/bookings/${b.id}/check-out`, {
              method: "POST",
              json: {
                units: u,
                payments:
                  balance > 0 ? [{ method, amount: balance, reference }] : [],
                refund_method: balance < 0 ? method : null,
                approval,
              },
            }),
          "Charge fewer nights than stayed",
        );
        if (r) onClose();
      }}
    >
      <Field
        label={b.stay_type === "short" ? "Hours to charge" : "Nights to charge"}
        hint={`The stay so far counts as ${nowUnits}. Charging less needs a manager; add more for a late check-out.`}
      >
        {(id) => (
          <Input
            id={id}
            type="number"
            min={b.stay_type === "short" ? 1 : 1}
            step={1}
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="tabular"
          />
        )}
      </Field>
      <dl className="space-y-1 rounded-xl bg-ground p-4 text-sm">
        <Line
          label={`Room (${u} × ${money(b.rate)})`}
          value={money(room)}
          hide={b.stay_type === "short"}
        />
        <Line label="Room" value={money(room)} hide={b.stay_type !== "short"} />
        <Line label="Extras" value={money(f.extras)} hide={!f.extras} />
        <Line label="Discount" value={money(f.discounts)} hide={!f.discounts} />
        <Line
          label={`Tax (${f.tax_percent}%)`}
          value={money(tax)}
          hide={!tax}
        />
        <Line
          label="Room service"
          value={money(f.room_service)}
          hide={!f.room_service}
        />
        <Line label="Total" value={money(total)} strong />
        <Line label="Already paid" value={money(f.paid)} hide={!f.paid} />
      </dl>
      <div className="flex items-baseline justify-between rounded-xl bg-bottle-900 px-4 py-3 text-white">
        <span className="text-sm text-bottle-200">
          {balance >= 0 ? "To pay now" : "Give back to the guest"}
        </span>
        <span className="text-3xl font-bold tabular">
          {money(Math.abs(balance))}
        </span>
      </div>
      {balance !== 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MethodSelect
            value={method}
            onChange={setMethod}
            label={balance > 0 ? "Paid by" : "Given back by"}
          />
          {balance > 0 && method !== "cash" && (
            <Field label="Reference (optional)">
              {(id) => (
                <Input
                  id={id}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={80}
                />
              )}
            </Field>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <Footer
        busy={busy}
        label={
          balance > 0 ? `Take ${money(balance)} and check out` : "Check out"
        }
        onClose={onClose}
      />
    </form>
  );
}

function estimateUnits(b: Booking, tz?: string): number {
  const start = new Date(b.checked_in_at ?? b.arrival);
  const end = new Date();
  if (b.stay_type === "short") {
    const minutes = Math.max(0, (end.getTime() - start.getTime()) / 60000 - 15);
    return Math.max(b.block_hours, Math.ceil(minutes / 60));
  }
  const day = (d: Date) =>
    d.toLocaleDateString("en-CA", tz ? { timeZone: tz } : undefined);
  return Math.max(1, nightsBetween(day(start), day(end)));
}

function Line({
  label,
  value,
  strong,
  hide,
}: {
  label: string;
  value: string;
  strong?: boolean;
  hide?: boolean;
}) {
  if (hide) return null;
  return (
    <div
      className={clsx(
        "flex justify-between",
        strong && "border-t border-line pt-1 font-semibold",
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

// ---- Charges and payments ---------------------------------------------------------------

function ChargeDialog({
  open,
  booking: b,
  act,
  busy,
  error,
  onClose,
}: DialogProps) {
  const [kind, setKind] = useState<"extra" | "discount">("extra");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <Modal open={open} title="Add to the room bill" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(
            (approval) =>
              api<Booking>(`/bookings/${b.id}/charges`, {
                method: "POST",
                json: { kind, description, amount: Number(amount), approval },
              }),
            "Approve discount",
          );
          if (r) {
            setDescription("");
            setAmount("");
            onClose();
          }
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["extra", "Extra charge", "Laundry, extra bed, late check-out"],
              ["discount", "Discount", "Needs a manager"],
            ] as const
          ).map(([k, t, d]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={clsx(
                "rounded-lg border p-3 text-left text-sm",
                kind === k
                  ? "border-amber-500 bg-amber-100/40"
                  : "border-line hover:bg-ground",
              )}
            >
              <span className="block font-medium">{t}</span>
              <span className="block text-ink-soft">{d}</span>
            </button>
          ))}
        </div>
        <Field label="Description">
          {(id) => (
            <Input
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                kind === "extra" ? "e.g. Laundry" : "e.g. Regular guest"
              }
              required
              minLength={2}
              maxLength={200}
            />
          )}
        </Field>
        <Field label="Amount">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="tabular"
            />
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
        <Footer
          busy={busy}
          label={kind === "extra" ? "Add charge" : "Give discount"}
          onClose={onClose}
        />
      </form>
    </Modal>
  );
}

function PaymentDialog({
  open,
  booking: b,
  act,
  busy,
  error,
  onClose,
}: DialogProps) {
  const money = useMoney();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FolioMethod>("cash");
  const [reference, setReference] = useState("");
  return (
    <Modal open={open} title="Take a payment" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() =>
            api<Booking>(`/bookings/${b.id}/payments`, {
              method: "POST",
              json: { method, amount: Number(amount), reference },
            }),
          );
          if (r) {
            setAmount("");
            setReference("");
            onClose();
          }
        }}
      >
        <p className="text-sm text-ink-soft">
          An advance or part payment. The balance now is{" "}
          <span className="font-semibold text-ink tabular">
            {money(b.folio.balance)}
          </span>
          {b.folio.estimated && " (estimate)"}.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="tabular"
              />
            )}
          </Field>
          <MethodSelect value={method} onChange={setMethod} />
        </div>
        {method !== "cash" && (
          <Field label="Reference (optional)">
            {(id) => (
              <Input
                id={id}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={80}
              />
            )}
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <Footer busy={busy} label="Save payment" onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---- Change dates, room, guest ---------------------------------------------------------------

function EditDialog({
  open,
  booking: b,
  act,
  busy,
  error,
  onClose,
}: DialogProps) {
  return (
    <Modal open={open} title="Change booking" onClose={onClose} size="lg">
      {open && (
        <EditBody
          booking={b}
          act={act}
          busy={busy}
          error={error}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function EditBody({
  booking: b,
  act,
  busy,
  error,
  onClose,
}: Omit<DialogProps, "open">) {
  const settings = useSettings().data;
  const inHouse = b.status === "checked_in";
  const arr = new Date(b.arrival);
  const dep = new Date(b.departure);
  const [arrDate, setArrDate] = useState(dateInput(arr));
  const [arrTime, setArrTime] = useState(arr.toTimeString().slice(0, 5));
  const [depDate, setDepDate] = useState(dateInput(dep));
  const [depTime, setDepTime] = useState(dep.toTimeString().slice(0, 5));
  const [room, setRoom] = useState(b.room.id);
  const [rate, setRate] = useState(String(b.rate));
  const [g, setG] = useState({
    guest_name: b.guest_name,
    phone: b.phone,
    id_type: b.id_type,
    id_number: b.id_number,
    address: b.address,
    vehicle_no: b.vehicle_no,
    note: b.note,
  });
  const set =
    (k: keyof typeof g) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setG((x) => ({ ...x, [k]: e.target.value }));

  const arrival = toISO(arrDate, arrTime);
  const departure = toISO(depDate, depTime);
  const rooms = useQuery({
    queryKey: ["rooms-available", arrival, departure, b.id],
    queryFn: () =>
      api<Room[]>(
        `/rooms/available?arrival=${encodeURIComponent(inHouse ? new Date().toISOString() : arrival)}&departure=${encodeURIComponent(departure)}&exclude_booking=${b.id}`,
      ),
    enabled: new Date(departure) > new Date(inHouse ? Date.now() : arrival),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, unknown> = { ...g, rate: Number(rate) };
        if (!inHouse && new Date(arrival).getTime() !== arr.getTime())
          body.arrival = arrival;
        if (new Date(departure).getTime() !== dep.getTime())
          body.departure = departure;
        if (room !== b.room.id) body.room_id = room;
        const r = await act(() =>
          api<Booking>(`/bookings/${b.id}`, { method: "PATCH", json: body }),
        );
        if (r) onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!inHouse && (
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Field label="Arrival">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={arrDate}
                  onChange={(e) => setArrDate(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Time">
              {(id) => (
                <Input
                  id={id}
                  type="time"
                  value={arrTime}
                  onChange={(e) => setArrTime(e.target.value)}
                  required
                />
              )}
            </Field>
          </div>
        )}
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label={inHouse ? "Leaving (extend or shorten)" : "Departure"}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={depDate}
                onChange={(e) => setDepDate(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Time">
            {(id) => (
              <Input
                id={id}
                type="time"
                value={depTime}
                onChange={(e) => setDepTime(e.target.value)}
                required
              />
            )}
          </Field>
        </div>
        {b.stay_type === "night" && (
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            <span className="text-sm text-ink-soft">Quick:</span>
            {[1, 2].map((n) => (
              <Button
                key={n}
                type="button"
                variant="secondary"
                onClick={() => {
                  setDepDate(addDays(depDate, n));
                  setDepTime(settings?.check_out_time ?? depTime);
                }}
              >
                <CalendarClock className="size-4" aria-hidden /> +{n}{" "}
                {n === 1 ? "night" : "nights"}
              </Button>
            ))}
          </div>
        )}
        <Field label="Room">
          {(id) => (
            <Select
              id={id}
              value={room}
              onChange={(e) => setRoom(Number(e.target.value))}
            >
              {!(rooms.data ?? []).some((r) => r.id === b.room.id) && (
                <option value={b.room.id}>
                  Room {b.room.number} (current)
                </option>
              )}
              {(rooms.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.number} · {r.room_type.name}
                  {r.id === b.room.id ? " (current)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={
            b.stay_type === "short"
              ? `Price for ${b.block_hours} hours`
              : "Price per night"
          }
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="tabular"
            />
          )}
        </Field>
        <Field label="Guest name">
          {(id) => (
            <Input
              id={id}
              value={g.guest_name}
              onChange={set("guest_name")}
              required
            />
          )}
        </Field>
        <Field label="Phone">
          {(id) => (
            <Input id={id} type="tel" value={g.phone} onChange={set("phone")} />
          )}
        </Field>
        <Field label="ID type">
          {(id) => (
            <Select id={id} value={g.id_type} onChange={set("id_type")}>
              {(Object.keys(ID_LABEL) as IdType[]).map((k) => (
                <option key={k} value={k}>
                  {ID_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`${ID_LABEL[g.id_type]} number`}>
          {(id) => (
            <Input id={id} value={g.id_number} onChange={set("id_number")} />
          )}
        </Field>
        <Field label="Address">
          {(id) => (
            <Input id={id} value={g.address} onChange={set("address")} />
          )}
        </Field>
        <Field label="Vehicle number">
          {(id) => (
            <Input id={id} value={g.vehicle_no} onChange={set("vehicle_no")} />
          )}
        </Field>
      </div>
      <Field label="Note">
        {(id) => (
          <Textarea
            id={id}
            value={g.note}
            onChange={set("note")}
            rows={2}
            maxLength={500}
          />
        )}
      </Field>
      <ErrorText>{error}</ErrorText>
      <Footer busy={busy} label="Save changes" onClose={onClose} />
    </form>
  );
}

// ---- Cancel -------------------------------------------------------------------------

function CancelDialog({
  open,
  booking: b,
  act,
  busy,
  error,
  onClose,
}: DialogProps) {
  const money = useMoney();
  const [reason, setReason] = useState("");
  const [noShow, setNoShow] = useState(false);
  const [advance, setAdvance] = useState<"refund" | "keep">("refund");
  const [method, setMethod] = useState<FolioMethod>("cash");
  const held = b.folio.paid - b.folio.extras;
  return (
    <Modal open={open} title="Cancel booking" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() =>
            api<Booking>(`/bookings/${b.id}/cancel`, {
              method: "POST",
              json: {
                reason,
                no_show: noShow,
                advance: held > 0 ? advance : null,
                refund_method: held > 0 && advance === "refund" ? method : null,
              },
            }),
          );
          if (r) onClose();
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={noShow}
            onChange={(e) => setNoShow(e.target.checked)}
            className="size-4 accent-amber-500"
          />
          The guest didn&apos;t come (no-show)
        </label>
        <Field label="Reason">
          {(id) => (
            <Input
              id={id}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={2}
              maxLength={300}
            />
          )}
        </Field>
        {held > 0 && (
          <fieldset className="space-y-2 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold">
              Advance of {money(held)}
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="adv"
                checked={advance === "refund"}
                onChange={() => setAdvance("refund")}
                className="accent-amber-500"
              />{" "}
              Give it back
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="adv"
                checked={advance === "keep"}
                onChange={() => setAdvance("keep")}
                className="accent-amber-500"
              />{" "}
              Keep it as a cancellation charge
            </label>
            {advance === "refund" && (
              <MethodSelect
                value={method}
                onChange={setMethod}
                label="Given back by"
              />
            )}
          </fieldset>
        )}
        <ErrorText>{error}</ErrorText>
        <Footer
          busy={busy}
          label={noShow ? "Mark as no-show" : "Cancel booking"}
          onClose={onClose}
          danger
        />
      </form>
    </Modal>
  );
}
