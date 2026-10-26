"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Download } from "lucide-react";
import { useState } from "react";

import { Button, ErrorText, Panel, Spinner } from "@/components/ui";
import { ApiError, api, tokens } from "@/lib/api";

type BackupList = {
  items: { name: string; size: number; created_at: string }[];
  keep: number;
  daily_at: string;
  automatic: boolean;
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupSettings() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["backups"],
    queryFn: () => api<BackupList>("/backups"),
  });
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const now = useMutation({
    mutationFn: () => api("/backups", { method: "POST" }),
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Backup failed"),
  });

  async function download(name: string) {
    // The download needs the login token, so fetch it and hand the file to the browser.
    setDownloading(name);
    setError("");
    try {
      await api("/auth/me"); // refreshes the token first if it expired
      const res = await fetch(`${BASE}/api/backups/${name}`, {
        headers: { Authorization: `Bearer ${tokens.get()?.access_token}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed. Try again.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Panel className="mt-6 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <DatabaseBackup className="size-4 text-ink-soft" aria-hidden /> Backups
      </h2>
      {list.isLoading || !list.data ? (
        <Spinner />
      ) : (
        <>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">
            {list.data.automatic
              ? `A full copy of all data is made every day after ${list.data.daily_at}, and the newest ${list.data.keep} are kept on the server.`
              : "Daily backups are turned off on this server."}{" "}
            Download one now and then and keep it somewhere safe, like Google
            Drive.
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              busy={now.isPending}
              onClick={() => now.mutate()}
            >
              Back up now
            </Button>
          </div>
          <ErrorText>{error}</ErrorText>
          {list.data.items.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">No backups yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {list.data.items.map((b) => (
                <li
                  key={b.name}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="flex-1">
                    {new Date(b.created_at).toLocaleString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    <span className="ml-2 text-ink-soft">{size(b.size)}</span>
                  </span>
                  <Button
                    variant="ghost"
                    busy={downloading === b.name}
                    onClick={() => download(b.name)}
                    aria-label={`Download backup from ${b.created_at}`}
                  >
                    <Download className="size-4" aria-hidden /> Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
