"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button, ErrorText, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/money";
import { METHOD_LABEL, qtyText } from "@/lib/pos";
import type { Order } from "@/lib/types";

const fmt = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * An 80 mm receipt. Opening this page records the print (so reprints say
 * COPY and later changes need a manager), then opens the print dialog.
 */
export default function PrintPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const { user, loading } = useAuth();
  const settings = useSettings();
  const qc = useQueryClient();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || started.current) return;
    started.current = true;
    api<Order>(`/orders/${id}/print`, { method: "POST" })
      .then((o) => {
        setOrder(o);
        // The bill screen must see that it's printed (removing items now needs a manager).
        qc.setQueryData(["orders", o.id], o);
        qc.invalidateQueries({ queryKey: ["tables"] });
        qc.invalidateQueries({ queryKey: ["orders", "open"] });
        setTimeout(() => window.print(), 300);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the bill"));
  }, [user, id, qc]);

  if (error) {
    return (
      <div className="mx-auto max-w-sm p-6">
        <ErrorText>{error}</ErrorText>
        <Button className="mt-4" variant="secondary" onClick={() => router.back()}>
          Back
        </Button>
      </div>
    );
  }
  if (!order || !settings.data) return <Spinner label="Preparing receipt" />;

  const s = settings.data;
  const isReceipt = order.status === "paid";
  const copy = isReceipt ? order.receipt_count > 1 : order.printed_count > 1;
  const when = new Date(order.closed_at ?? order.created_at);

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
        <Button variant="secondary" onClick={() => router.push(`/pos/${order.id}`)}>
          <ArrowLeft className="size-4" aria-hidden /> Back to bill
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
          <p className="mt-2 font-bold">{isReceipt ? "RECEIPT" : "BILL"}</p>
          {copy && <p className="font-bold">*** COPY ***</p>}
          {order.status === "void" && <p className="font-bold">*** VOID ***</p>}
        </div>

        <Dashes />
        <Pair left={`#${order.id}  ${order.label}`} right="" />
        <Pair
          left={when.toLocaleDateString("en-GB")}
          right={when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        />
        <Pair left={`Served by ${order.opener?.name ?? ""}`} right="" />
        <Dashes />

        {order.lines.map((l) => (
          <div key={l.id} className="mb-1">
            <p>{l.name}</p>
            <Pair left={`  ${qtyText(l.qty)} x ${fmt.format(l.unit_price)}`} right={fmt.format(l.line_total)} />
          </div>
        ))}
        <Dashes />

        <Pair left="Subtotal" right={fmt.format(order.subtotal)} />
        {order.discount > 0 && <Pair left={`Discount${order.discount_type === "percent" ? ` ${order.discount_value}%` : ""}`} right={`-${fmt.format(order.discount)}`} />}
        {order.service_charge > 0 && <Pair left={`Service charge ${order.service_charge_percent}%`} right={fmt.format(order.service_charge)} />}
        {order.tax > 0 && <Pair left={`Tax ${order.tax_percent}%`} right={fmt.format(order.tax)} />}
        <div className="my-1 flex justify-between text-[14px] font-bold">
          <span>TOTAL {s.currency_symbol}</span>
          <span>{fmt.format(order.total)}</span>
        </div>

        {order.payments.length > 0 && (
          <>
            <Dashes />
            {order.payments.map((p) => (
              <div key={p.id}>
                <Pair left={METHOD_LABEL[p.method]} right={fmt.format(p.amount)} />
                {p.tendered != null && <Pair left="  Cash given" right={fmt.format(p.tendered)} />}
                {p.change > 0 && <Pair left="  Change" right={fmt.format(p.change)} />}
                {p.tip > 0 && <Pair left="  Tip" right={fmt.format(p.tip)} />}
              </div>
            ))}
            {order.due > 0 && <Pair left="Still to pay" right={fmt.format(order.due)} />}
          </>
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
  return <p className="my-1 overflow-hidden whitespace-nowrap">{"-".repeat(48)}</p>;
}
