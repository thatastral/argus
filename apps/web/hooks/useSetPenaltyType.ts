"use client";

import { useState } from "react";
import { useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { PENALTY_TYPE_INDEX, type PenaltyType } from "@/lib/penalty";
import { friendlyErrorMessage } from "@/lib/formatError";

/// Shared configurePenalty() + Supabase mirror sequence — extracted out of SettingsSheet.tsx
/// once chat's function-calling needed the exact same logic. Renamed from the old
/// useSetStake.ts/setStake (which also took an `amount`) — the per-habit stake amount moved to
/// HabitManager.habitStake, locked in once at each habit's own creation (see
/// useCreateHabit.ts), so there is no more wallet-level "current stake" left to set here. This
/// now only ever changes the consequence type (Savings Vault vs Donate), which stays a single
/// wallet-level choice applying uniformly to any day's failure.
export function useSetPenaltyType() {
  const { writeContractAsync } = useWriteContract();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setPenaltyType(penaltyType: PenaltyType): Promise<boolean> {
    if (!addresses.penaltyEngine) {
      setError("Contracts not deployed yet");
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      await writeContractAsync({
        address: addresses.penaltyEngine,
        abi: abis.penaltyEngine,
        functionName: "configurePenalty",
        args: [PENALTY_TYPE_INDEX[penaltyType]],
        chainId: activeChain.id,
      });

      const mirrorRes = await fetch("/api/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ penaltyType }),
      });
      if (!mirrorRes.ok) throw new Error("Consequence updated on-chain but failed to save — refresh and try again");

      return true;
    } catch (err) {
      setError(friendlyErrorMessage(err, "Failed to update consequence"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { setPenaltyType, busy, error };
}
