"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";

/// Streak/completion numbers read live from HabitManager. Supabase has a `streak_cache` table
/// intended as a fast-read denormalized copy, but nothing in this codebase currently writes to
/// it — reading it would always return null. HabitManager is already the source of truth for
/// this data (see CLAUDE.md's on-chain/off-chain split), so read it directly instead.
export function useStreak() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: activeChain.id });

  const [settling, setSettling] = useState(false);
  const [settleMessage, setSettleMessage] = useState<string | null>(null);

  const { data: currentStreak, refetch: refetchCurrent } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "currentStreak",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager) },
  });

  const { data: longestStreak, refetch: refetchLongest } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "longestStreak",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager) },
  });

  const { data: completionRateBps, refetch: refetchCompletion } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "completionRateBps",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager) },
  });

  function refetchAll() {
    refetchCurrent();
    refetchLongest();
    refetchCompletion();
  }

  /// HabitManager.settle() is permissionless but nothing calls it automatically — there's no
  /// cron/keeper deployed yet (documented gap in CLAUDE.md). Standing in for that until one
  /// exists: let the user trigger it themselves for their own address.
  ///
  /// Simulates first rather than sending straight to the wallet: a plain writeContractAsync
  /// only surfaces whatever bare message the wallet extension returns on revert (confirmed
  /// live — MetaMask returned undecoded "execution reverted" for a different custom error,
  /// with no way to tell NothingToSettle apart from a real failure). simulateContract decodes
  /// the custom error client-side before ever prompting a signature, so "nothing owed yet" (the
  /// common case — this button will usually be pressed before a full day has passed) can be
  /// shown as normal status text instead of a wallet popup the user has to reject.
  async function settleToday() {
    if (!address || !addresses.habitManager || !publicClient) return;
    setSettling(true);
    setSettleMessage(null);
    try {
      // Simulate first purely for the decoded revert reason (NothingToSettle vs a real
      // failure) — see the comment above. The actual send below is the same plain call shape
      // used everywhere else in this codebase; passing simulateContract's `request` straight
      // into writeContractAsync trips wagmi's stricter typed-ABI overload matching against
      // this project's plain-JSON-imported ABIs.
      await publicClient.simulateContract({
        address: addresses.habitManager,
        abi: abis.habitManager,
        functionName: "settle",
        args: [address],
        account: address,
      });
      await writeContractAsync({
        address: addresses.habitManager,
        abi: abis.habitManager,
        functionName: "settle",
        args: [address],
        chainId: activeChain.id,
      });
      setSettleMessage("Settled — your streak is up to date.");
      refetchAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("NothingToSettle")) {
        setSettleMessage("You're all caught up — nothing to settle yet.");
      } else if (message.includes("NoHabitsYet")) {
        setSettleMessage("No habits to settle yet.");
      } else {
        setSettleMessage("Couldn't settle right now — try again shortly.");
      }
    } finally {
      setSettling(false);
    }
  }

  return {
    currentStreak: currentStreak !== undefined ? Number(currentStreak) : undefined,
    longestStreak: longestStreak !== undefined ? Number(longestStreak) : undefined,
    completionRateBps: completionRateBps !== undefined ? Number(completionRateBps) : undefined,
    refetchAll,
    settleToday,
    settling,
    settleMessage,
  };
}
