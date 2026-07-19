"use client";

import { useState } from "react";
import { friendlyErrorMessage } from "@/lib/formatError";

/// Renaming needs no on-chain call — habit names are Supabase-only (see CLAUDE.md's on-chain
/// vs off-chain split). Reuses the same POST /api/habits upsert that habit creation uses; on an
/// already-active habit this only ever overwrites `name`, `active` stays true either way.
export function useRenameHabit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function renameHabit(contractIndex: number, name: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIndex, name }),
      });
      if (!res.ok) throw new Error("Failed to rename habit");
      return true;
    } catch (err) {
      setError(friendlyErrorMessage(err, "Failed to rename habit"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { renameHabit, busy, error };
}
