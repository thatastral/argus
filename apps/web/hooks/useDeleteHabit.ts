"use client";

import { useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { friendlyErrorMessage } from "@/lib/formatError";

/// "Delete" a habit — HabitManager has no slot reuse, so this is really
/// setHabitActive(index, false) (see CLAUDE.md's gotcha on the 3-habit cap counting total ever
/// created, not just active). Wallet-signed like useCreateHabit.ts (only msg.sender may call
/// it), same cancelledRef/cancel() stuck-request pattern for the same reason (see CLAUDE.md's
/// gotcha on wallet requests having no AbortController).
export function useDeleteHabit() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: activeChain.id });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  function cancel() {
    cancelledRef.current = true;
    setBusy(false);
    setError("Cancelled — check your wallet extension for a stuck request, then try again.");
  }

  async function syncMirror(contractIndex: number) {
    const mirrorRes = await fetch("/api/habits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractIndex }),
    });
    if (!mirrorRes.ok) throw new Error("Habit removed on-chain but failed to sync — refresh and try again");
  }

  async function deleteHabit(contractIndex: number): Promise<boolean> {
    if (!address || !addresses.habitManager || !publicClient) return false;

    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    try {
      // Simulate first purely for the decoded revert reason — same reasoning as
      // useStreak.ts's settleToday(): a plain writeContractAsync only surfaces the wallet
      // extension's bare "execution reverted" text, with no way to tell "this index was never
      // real on-chain" (a genuine mirror/on-chain mismatch — confirmed live: a Supabase row for
      // a habit slot that a wallet's on-chain habitCount never actually reached) apart from any
      // other failure.
      try {
        await publicClient.simulateContract({
          address: addresses.habitManager,
          abi: abis.habitManager,
          functionName: "setHabitActive",
          args: [BigInt(contractIndex), false],
          account: address,
        });
      } catch (simErr) {
        const message = simErr instanceof Error ? simErr.message : "";
        if (message.includes("InvalidHabitIndex")) {
          // Nothing to deactivate on-chain — this slot was never actually created there, so the
          // correct fix is just removing the stale Supabase row, no wallet signature needed.
          await syncMirror(contractIndex);
          return true;
        }
        throw new Error("Couldn't delete this habit on-chain — try again shortly.");
      }

      await writeContractAsync({
        address: addresses.habitManager,
        abi: abis.habitManager,
        functionName: "setHabitActive",
        args: [BigInt(contractIndex), false],
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return false;

      await syncMirror(contractIndex);
      return true;
    } catch (err) {
      if (!cancelledRef.current) setError(friendlyErrorMessage(err, "Failed to delete habit"));
      return false;
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  return { deleteHabit, busy, error, cancel };
}
