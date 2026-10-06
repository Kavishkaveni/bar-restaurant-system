"use client";

import { Lock } from "lucide-react";

import { useAuth } from "@/lib/auth";

/** Shows the page only if the user has at least one of the permissions. */
export function Guard({ anyOf, children }: { anyOf: string[]; children: React.ReactNode }) {
  const { can } = useAuth();
  if (anyOf.some((p) => can(p))) return <>{children}</>;
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <Lock className="mb-3 size-8 text-ink-soft" aria-hidden />
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-1 text-sm text-ink-soft">Ask the owner to change your role if you need it.</p>
    </div>
  );
}
