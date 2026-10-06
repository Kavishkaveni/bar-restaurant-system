"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth";
import { visibleNav } from "@/lib/nav";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { user, can } = useAuth();
  const items = visibleNav((p) => can(p));

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">
        {greeting()}, {user?.name.split(" ")[0]}
      </h1>
      <p className="mt-1 text-sm text-ink-soft">Pick where you want to work.</p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex h-full gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-amber-500"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-bottle-100 text-bottle-800">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-sm text-ink-soft">{item.blurb}</span>
                  {item.phase && <span className="mt-2 block text-xs text-amber-600">Arrives in phase {item.phase}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
