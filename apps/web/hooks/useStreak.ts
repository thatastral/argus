"use client";

import { useAccount, useReadContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";

/// Streak/completion numbers read live from HabitManager. Supabase has a `streak_cache` table
/// intended as a fast-read denormalized copy, but nothing in this codebase currently writes to
/// it — reading it would always return null. HabitManager is already the source of truth for
/// this data (see CLAUDE.md's on-chain/off-chain split), so read it directly instead.
///
/// Settlement itself is automatic, not something the UI triggers — lib/chain.ts's
/// settlePendingDays() runs server-side (best-effort, via next/server's after()) from both
/// /api/state (every dashboard load) and /api/verify (after a proof is submitted), so by the
/// time any of these reads happen the account is already caught up in the common case. There
/// used to be a manual "Settle today" button here for this; removed once the automatic path
/// existed, since surfacing it just implied (wrongly) that the user still had to do something.
export function useStreak() {
  const { address } = useAccount();

  // refetchInterval is what makes the displayed number actually move without a full page reload
  // once the server-side catch-up above lands — these otherwise only fetch once on mount.
  const { data: currentStreak, refetch: refetchCurrent } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "currentStreak",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager), refetchInterval: 20_000 },
  });

  const { data: longestStreak, refetch: refetchLongest } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "longestStreak",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager), refetchInterval: 20_000 },
  });

  const { data: completionRateBps, refetch: refetchCompletion } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "completionRateBps",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager), refetchInterval: 20_000 },
  });

  function refetchAll() {
    refetchCurrent();
    refetchLongest();
    refetchCompletion();
  }

  return {
    currentStreak: currentStreak !== undefined ? Number(currentStreak) : undefined,
    longestStreak: longestStreak !== undefined ? Number(longestStreak) : undefined,
    completionRateBps: completionRateBps !== undefined ? Number(completionRateBps) : undefined,
    refetchAll,
  };
}
