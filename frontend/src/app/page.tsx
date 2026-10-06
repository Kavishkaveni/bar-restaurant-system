"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(user ? "/home" : "/login");
  }, [user, loading, router]);
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner />
    </div>
  );
}
