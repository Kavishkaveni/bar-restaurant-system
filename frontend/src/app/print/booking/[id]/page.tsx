"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Button, ErrorText, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/money";
import { FOLIO_METHODS, ID_LABEL } from "@/lib/rooms";
import type { Booking } from "@/lib/types";

const fmt = new Intl.NumberFormat("en-LK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The room bill on the 80 mm receipt printer. */
export default function PrintBookingPage() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const { user, loading } = useAuth();
  const settings = useSettings();
  const booking = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api<Booking>(`/bookings/${id}`),
    enabled: !!user,
  });
  const printed = useRef(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  useEffect(() => {
    if (booking.data && settings.data && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [booking.data, settings.data]);

  if (booking.error)
    return (
      <ErrorText>
        {booking.error instanceof ApiError
          ? booking.error.message
          : "Could not load the bill"}
      </ErrorText>
    );
  const b = booking.data;
  const s = settings.data;
  if (!b || !s) return <Spinner label="Preparing bill" />;
  const f = b.folio;
  const settled = b.status === "checked_out";

  return (
    <>
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .receipt { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
        <Button
          variant="secondary"
          onClick={() => router.push(`/rooms/bookings/${b.id}`)}
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to booking
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Print
        </Button>
      </div>

      <div className="receipt mx-auto my-6 w-[80mm] bg-white px-[4mm] py-[5mm] font-mono text-[11.5px] leading-snug text-black shadow-lg">
        <div className="text-center">
          <p className="text-[15px] font-bold">{s.business_name}</p>
          {s.address && <p>{s.address}</p>}
          {s.phone && <p>Tel {s.phone}</p>}
          <p className="mt-2 font-bold">
            {settled ? "ROOM BILL - PAID" : "ROOM BILL"}
          </p>
          {(b.status === "cancelled" || b.status === "no_show") && (
            <p className="font-bold">
              *** {b.status === "no_show" ? "NO-SHOW" : "CANCELLED"} ***
            </p>
          )}
        </div>
        <Dashes />
        <Pair left={`Booking #${b.id}`} right={`Room ${b.room.number}`} />
        <p>{b.guest_name}</p>
        {b.id_number && (
          <p>
            {ID_LABEL[b.id_type]} {b.id_number}
          </p>
        )}
        {b.phone && <p>{b.phone}</p>}
        <Pair left="In" right={when(b.checked_in_at ?? b.arrival)} />
        <Pair left="Out" right={when(b.checked_out_at ?? b.departure)} />
        <Dashes />

        {b.status !== "cancelled" && b.status !== "no_show" && (
          <div className="mb-1">
            <p>{b.room.room_type.name}</p>
            <Pair
              left={
                b.stay_type === "short"
                  ? `  ${f.units} hours`
                  : `  ${f.units} night${f.units === 1 ? "" : "s"} x ${fmt.format(b.rate)}`
              }
              right={fmt.format(f.room_charge)}
            />
          </div>
        )}
        {b.charges.map((c) => (
          <Pair key={c.id} left={c.description} right={fmt.format(c.amount)} />
        ))}
        {f.tax > 0 && (
          <Pair left={`Tax ${f.tax_percent}%`} right={fmt.format(f.tax)} />
        )}
        <div className="my-1 flex justify-between text-[14px] font-bold">
          <span>TOTAL {s.currency_symbol}</span>
          <span>{fmt.format(f.total)}</span>
        </div>
        {b.payments.length > 0 && (
          <>
            <Dashes />
            {b.payments.map((p) => (
              <Pair
                key={p.id}
                left={`${p.kind === "refund" ? "Refund" : "Paid"} ${FOLIO_METHODS.find((m) => m.key === p.method)?.label}`}
                right={`${p.kind === "refund" ? "-" : ""}${fmt.format(p.amount)}`}
              />
            ))}
          </>
        )}
        <Pair
          left={f.balance >= 0 ? "BALANCE" : "TO REFUND"}
          right={fmt.format(Math.abs(f.balance))}
        />
        {f.estimated && (
          <p className="mt-1">Room charge is an estimate until check-out.</p>
        )}
        <Dashes />
        {s.receipt_footer && <p className="text-center">{s.receipt_footer}</p>}
      </div>
    </>
  );
}

function Pair({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="whitespace-pre-wrap">{left}</span>
      <span className="shrink-0">{right}</span>
    </div>
  );
}

function Dashes() {
  return (
    <p className="my-1 overflow-hidden whitespace-nowrap">{"-".repeat(48)}</p>
  );
}
