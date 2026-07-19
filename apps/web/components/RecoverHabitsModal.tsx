"use client";

import { useState } from "react";
import type { UnmirroredHabit } from "@/hooks/useUnmirroredHabits";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { useToast } from "./Toast";
import { friendlyErrorMessage } from "@/lib/formatError";

/// Dashboard counterpart to SetupFlow.tsx's inline recovery step — same underlying detection
/// (useUnmirroredHabits.ts), but rendered as a Modal since it can surface any time "+ Add Habit"
/// is used post-setup, not just during onboarding (confirmed live: a habit mirror write failing
/// after a real on-chain createHabit() tx, leaving an orphaned unnamed slot). No close button —
/// this has to be resolved before creating anything new, or a retry would silently create a
/// second orphaned slot (HabitManager has no dedupe).
export function RecoverHabitsModal({
  open,
  habits,
  onSaved,
}: {
  open: boolean;
  habits: UnmirroredHabit[];
  onSaved: () => void;
}) {
  const [names, setNames] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  // A deployed vault always exists by the time this modal is reachable (habits can't exist
  // without one — see the mandatory-funding onboarding gate), so its live asset is authoritative
  // for mirroring each orphaned habit's real on-chain stake (useUnmirroredHabits.ts already reads
  // habitStake itself).
  const { symbol, assetDecimals } = useAccountabilityWallet();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const h of habits) {
        const name = (names[h.contractIndex] ?? "").trim();
        const res = await fetch("/api/habits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractIndex: h.contractIndex,
            name,
            isNewHabit: true,
            stakeAmountWei: h.stakeAmountWei,
            assetSymbol: symbol,
            assetDecimals,
          }),
        });
        if (!res.ok) throw new Error("Failed to save a recovered habit — try again");
      }
      toast(`Recovered ${habits.length} habit${habits.length === 1 ? "" : "s"}`);
      onSaved();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Failed to save recovered habits"));
    } finally {
      setSaving(false);
    }
  }

  const allNamed = habits.every((h) => (names[h.contractIndex] ?? "").trim());

  return (
    <Modal open={open} title="Existing habits found" onClose={() => {}} dismissible={false}>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Found {habits.length} unnamed habit slot{habits.length === 1 ? "" : "s"} on-chain — likely from a creation that succeeded on-chain but failed to save. Name {habits.length === 1 ? "it" : "each one"} to bring {habits.length === 1 ? "it" : "them"} into your dashboard.
        </p>
        {habits.map((h) => (
          <input
            key={h.contractIndex}
            value={names[h.contractIndex] ?? ""}
            onChange={(e) => setNames((prev) => ({ ...prev, [h.contractIndex]: e.target.value }))}
            placeholder={`Name for habit slot ${h.contractIndex + 1}`}
            className="w-full rounded-md bg-surface px-3 py-2 text-sm"
          />
        ))}
        <button
          onClick={save}
          disabled={saving || !allNamed}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
        >
          {saving && <Spinner size={14} />}
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
