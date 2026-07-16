"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, type UsePublicClientReturnType } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";

export interface UnmirroredHabit {
  contractIndex: number;
}

interface ScanResult {
  unmirrored: UnmirroredHabit[];
  activeCount: number;
}

const contractsDeployed = Boolean(addresses.habitManager && addresses.penaltyEngine && addresses.argusFactory);

/// Walks every index up to lifetime habitCount() and checks habitActive() on each — this is the
/// only accurate way to get a user's *active* habit count from chain, since HabitManager exposes
/// no external activeCount()/MAX_HABITS-remaining view (only the internal `_activeCount` used by
/// createHabit()'s own revert check). Deliberately re-derived here rather than trusted from
/// Supabase's `active` mirror column, since on-chain is the source of truth (see
/// CLAUDE.md's on-chain-vs-off-chain split) and mirror drift is exactly the failure mode this
/// hook already exists to catch for `unmirrored`.
async function scanHabits(
  address: `0x${string}`,
  publicClient: NonNullable<UsePublicClientReturnType>,
): Promise<ScanResult> {
  const count = (await publicClient.readContract({
    address: addresses.habitManager!,
    abi: abis.habitManager,
    functionName: "habitCount",
    args: [address],
  })) as bigint;

  if (count === 0n) return { unmirrored: [], activeCount: 0 };

  const existingRes = await fetch("/api/habits");
  const existing: { contract_index: number }[] = existingRes.ok ? (await existingRes.json()).habits : [];
  const mirroredIndexes = new Set(existing.map((h) => h.contract_index));

  const unmirrored: UnmirroredHabit[] = [];
  let activeCount = 0;
  for (let i = 0; i < Number(count); i++) {
    const active = (await publicClient.readContract({
      address: addresses.habitManager!,
      abi: abis.habitManager,
      functionName: "habitActive",
      args: [address, BigInt(i)],
    })) as boolean;

    if (!active) continue;
    activeCount++;
    if (!mirroredIndexes.has(i)) unmirrored.push({ contractIndex: i });
  }

  return { unmirrored, activeCount };
}

/// A habit can exist on-chain (createHabit succeeded) without ever making it into Supabase — the
/// mirror POST failing (a stale session, or the DB rejecting a write — confirmed live: a missing
/// migration column) leaves an on-chain-active slot with no name anywhere. HabitManager has no
/// reset and no dedupe, so retrying "Create habit" in that state doesn't retry the save, it
/// creates a second orphaned on-chain slot. Both SetupFlow.tsx (onboarding) and HabitList.tsx
/// (the ongoing dashboard — the same failure can happen any time "+ Add Habit" is used, not just
/// during setup) need to detect and let the user resolve this before creating anything new.
///
/// `unmirrored === null` means "not checked yet"; `[]` means "checked, nothing to recover."
/// `activeCount` rides along on the same scan — HabitList.tsx uses it (not the raw lifetime
/// habitCount()) to gate "+ Add Habit", since MAX_HABITS is enforced against *active* habits
/// on-chain (see HabitManager.createHabit()'s `_activeCount` check) and there's no cheaper
/// on-chain view for it.
export function useUnmirroredHabits() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const [unmirrored, setUnmirrored] = useState<UnmirroredHabit[] | null>(null);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  // Imperative re-check (after saving a recovered habit, etc.) — deliberately separate from the
  // mount effect below rather than shared, so the effect can set state via a .then() callback
  // instead of calling a named async function directly (see CLAUDE.md's set-state-in-effect
  // gotcha; same duplication-over-sharing tradeoff already used by HabitList.tsx's `load`).
  const recheck = useCallback(async () => {
    if (!contractsDeployed || !address || !publicClient) return;
    setChecking(true);
    try {
      const result = await scanHabits(address, publicClient);
      setUnmirrored(result.unmirrored);
      setActiveCount(result.activeCount);
    } catch {
      setUnmirrored([]);
      setActiveCount(0);
    } finally {
      setChecking(false);
    }
  }, [address, publicClient]);

  // `unmirrored === null` is the loading indicator for this initial check (rather than
  // `checking`, which would need a synchronous setState(true) at the top of this effect body —
  // exactly what the lint rule above is guarding against).
  useEffect(() => {
    if (!contractsDeployed || !address || !publicClient) return;
    let cancelled = false;

    scanHabits(address, publicClient)
      .then((result) => {
        if (!cancelled) {
          setUnmirrored(result.unmirrored);
          setActiveCount(result.activeCount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnmirrored([]);
          setActiveCount(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  return { unmirrored, activeCount, checking, recheck };
}
