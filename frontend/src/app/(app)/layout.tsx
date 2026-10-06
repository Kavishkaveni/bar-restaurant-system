"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AppShell } from "@/components/AppShell";
import { Spinner } from "@/components/ui";
import { ApprovalProvider } from "@/lib/approval";
import { useAuth } from "@/lib/auth";
import { LiveUpdates } from "@/lib/live";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <LiveUpdates>
      <ApprovalProvider>
        <AppShell>{children}</AppShell>
      </ApprovalProvider>
    </LiveUpdates>
  );
}
