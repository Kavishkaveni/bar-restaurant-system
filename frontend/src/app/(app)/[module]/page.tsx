"use client";

import { notFound, useParams } from "next/navigation";

import { Guard } from "@/components/Guard";
import { PageHeader, Panel } from "@/components/ui";
import { NAV } from "@/lib/nav";

/** Placeholder for modules that later build phases deliver. */
export default function UpcomingModule() {
  const { module } = useParams<{ module: string }>();
  const item = NAV.find((n) => n.href === `/${module}` && n.phase);
  if (!item) notFound();
  const Icon = item.icon;

  return (
    <Guard anyOf={item.anyOf}>
      <PageHeader title={item.label} description={item.blurb} />
      <Panel className="flex flex-col items-center px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-amber-100 text-amber-600">
          <Icon className="size-7" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Arrives in phase {item.phase}</h2>
        <p className="mt-1 max-w-sm text-sm text-ink-soft">
          This page is part of the build plan. Your role already has access, so it will appear here as soon as it&apos;s built.
        </p>
      </Panel>
    </Guard>
  );
}
