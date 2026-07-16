"use client";

import { useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";

const contractsDeployed = Boolean(addresses.habitManager && addresses.penaltyEngine && addresses.argusFactory);

/// Shared on-chain createHabit() + Supabase mirror sequence — originally inlined in
/// SetupFlow.tsx, extracted once a second call site (the post-setup "+ Add Habit" flow, and
/// chat's function-calling confirm) needed the exact same logic. Keeping it in one place avoids
/// the two copies drifting, especially the fiddly bit where the mirror's contract_index must be
/// read fresh right before the on-chain call rather than assumed.
export function useCreateHabit() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: activeChain.id });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wallet requests have no AbortController — see CLAUDE.md's gotcha on this. Lets the caller
  // give up locally if a request never resolves, without acting on a stale response later.
  const cancelledRef = useRef(false);

  function cancel() {
    cancelledRef.current = true;
    setBusy(false);
    setError("Cancelled — check your wallet extension for a stuck request, then try again.");
  }

  async function createHabit(name: string, targetDays?: number | null, deadlineTime?: string | null): Promise<boolean> {
    if (!contractsDeployed) {
      setError("Contracts not deployed yet");
      return false;
    }
    // Every other create-habit entry point (SetupFlow, AddHabitModal) renders
    // WalletReconnect.tsx itself when disconnected, so this used to be unreachable elsewhere —
    // but ChatSidebar.tsx's "Confirm" button called straight into this with no such guard,
    // silently no-oping. Set a real error instead so a caller that doesn't check `isConnected`
    // up front still gets something visible.
    if (!isConnected || !publicClient || !address) {
      setError("Your wallet disconnected — reconnect to continue.");
      return false;
    }

    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    try {
      // createHabit() always appends, so the new habit's index is whatever the count was
      // right before this call — read it fresh rather than assuming any particular index.
      const indexBefore = (await publicClient.readContract({
        address: addresses.habitManager!,
        abi: abis.habitManager,
        functionName: "habitCount",
        args: [address],
      })) as bigint;

      await writeContractAsync({
        address: addresses.habitManager!,
        abi: abis.habitManager,
        functionName: "createHabit",
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return false;

      const mirrorRes = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractIndex: Number(indexBefore),
          name,
          targetDays: targetDays ?? null,
          deadlineTime: deadlineTime ?? null,
        }),
      });
      if (!mirrorRes.ok) throw new Error("Habit created on-chain but failed to save — refresh and try again");

      return true;
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to create habit on-chain");
      return false;
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  return { createHabit, busy, error, cancel, contractsDeployed, isConnected };
}
