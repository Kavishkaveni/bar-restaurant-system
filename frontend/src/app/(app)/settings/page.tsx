"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Guard } from "@/components/Guard";
import {
  Button,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Panel,
  Spinner,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { BusinessSettings } from "@/lib/types";

export default function SettingsPage() {
  return (
    <Guard anyOf={["settings.manage"]}>
      <Settings />
    </Guard>
  );
}

function Settings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<BusinessSettings>("/settings"),
  });
  const [form, setForm] = useState<BusinessSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (body: BusinessSettings) =>
      api<BusinessSettings>("/settings", { method: "PUT", json: body }),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      setSaved(true);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  if (query.isLoading || !form) return <Spinner />;

  const set = <K extends keyof BusinessSettings>(
    key: K,
    value: BusinessSettings[K],
  ) => {
    setSaved(false);
    setForm({ ...form, [key]: value });
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="These details appear on receipts and reports."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate(form);
        }}
      >
        <Panel className="divide-y divide-line">
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Business</h2>
            <Field label="Business name">
              {(id) => (
                <Input
                  id={id}
                  value={form.business_name}
                  onChange={(e) => set("business_name", e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Phone">
              {(id) => (
                <Input
                  id={id}
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                {(id) => (
                  <Input
                    id={id}
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Money</h2>
            <Field label="Currency code">
              {(id) => (
                <Input
                  id={id}
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value)}
                  maxLength={8}
                />
              )}
            </Field>
            <Field
              label="Currency symbol"
              hint="Printed before amounts, e.g. Rs. 1,500.00"
            >
              {(id) => (
                <Input
                  id={id}
                  value={form.currency_symbol}
                  onChange={(e) => set("currency_symbol", e.target.value)}
                  maxLength={8}
                />
              )}
            </Field>
            <Field label="Tax (%)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="tabular"
                  value={form.tax_percent}
                  onChange={(e) => set("tax_percent", Number(e.target.value))}
                />
              )}
            </Field>
            <Field label="Service charge (%)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="tabular"
                  value={form.service_charge_percent}
                  onChange={(e) =>
                    set("service_charge_percent", Number(e.target.value))
                  }
                />
              )}
            </Field>
            <Field
              label="Kitchen overhead %"
              hint="Gas, electricity and oil, added on top of ingredient cost when the system shows what a dish costs you. Leave 0 if unsure."
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="tabular"
                  value={form.overhead_percent}
                  onChange={(e) =>
                    set("overhead_percent", Number(e.target.value))
                  }
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <h2 className="font-semibold sm:col-span-3">Rooms</h2>
            <Field label="Check-in time">
              {(id) => (
                <Input
                  id={id}
                  type="time"
                  value={form.check_in_time}
                  onChange={(e) => set("check_in_time", e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Check-out time">
              {(id) => (
                <Input
                  id={id}
                  type="time"
                  value={form.check_out_time}
                  onChange={(e) => set("check_out_time", e.target.value)}
                  required
                />
              )}
            </Field>
            <Field
              label="Room tax (%)"
              hint="On room charges and extras. Room service already has its own tax."
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="tabular"
                  value={form.room_tax_percent}
                  onChange={(e) =>
                    set("room_tax_percent", Number(e.target.value))
                  }
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 p-5">
            <h2 className="font-semibold">Receipt</h2>
            <Field label="Message at the bottom of each receipt">
              {(id) => (
                <Input
                  id={id}
                  value={form.receipt_footer}
                  onChange={(e) => set("receipt_footer", e.target.value)}
                  maxLength={300}
                />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 p-5">
            <ErrorText>{error}</ErrorText>
            {saved && <span className="text-sm text-ok">Settings saved</span>}
            <Button type="submit" busy={save.isPending}>
              Save settings
            </Button>
          </div>
        </Panel>
      </form>
    </>
  );
}
