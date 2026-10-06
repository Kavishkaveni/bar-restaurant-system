"use client";

import clsx from "clsx";
import { LogOut, Menu, UserRound, Wine, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { type NavItem, visibleNav } from "@/lib/nav";

const GROUPS: NavItem["group"][] = ["Service", "Back office", "Admin"];

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {GROUPS.map((group) => {
        const groupItems = items.filter((i) => i.group === group);
        if (!groupItems.length) return null;
        return (
          <div key={group}>
            <p className="mb-1 px-3 text-xs font-medium text-bottle-200/70">{group}</p>
            <ul className="space-y-0.5">
              {groupItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active ? "bg-amber-500 text-bottle-950" : "text-bottle-100 hover:bg-bottle-800",
                      )}
                    >
                      <Icon className="size-4.5 shrink-0" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.phase && !active && <span className="text-[11px] text-bottle-200/60">Soon</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UserBox() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="border-t border-bottle-800 p-3">
      <Link href="/account" className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-bottle-800">
        <UserRound className="size-5 text-bottle-200" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
          <span className="block text-xs text-bottle-200">{user.role.label}</span>
        </span>
      </Link>
      <button
        onClick={logout}
        className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-bottle-100 hover:bg-bottle-800"
      >
        <LogOut className="size-4.5" aria-hidden /> Log out
      </button>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/home" className="flex items-center gap-2 px-6 py-5 text-white">
      <Wine className="size-6 text-amber-400" aria-hidden />
      <span className="font-semibold">Bar &amp; Restaurant</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { can } = useAuth();
  const items = visibleNav((p) => can(p));
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-bottle-900 lg:flex">
        <Brand />
        <NavLinks items={items} />
        <UserBox />
      </aside>

      {/* Phone and tablet top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-bottle-900 px-2 lg:hidden">
        <Link href="/home" className="flex items-center gap-2 px-2 text-white">
          <Wine className="size-5 text-amber-400" aria-hidden />
          <span className="font-semibold">Bar &amp; Restaurant</span>
        </Link>
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-white hover:bg-bottle-800" aria-label="Open menu">
          <Menu className="size-6" />
        </button>
      </header>

      {/* Phone and tablet slide-in menu */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-bottle-950/60" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-bottle-900">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-white hover:bg-bottle-800" aria-label="Close menu">
                <X className="size-6" />
              </button>
            </div>
            <NavLinks items={items} onNavigate={() => setOpen(false)} />
            <UserBox />
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
