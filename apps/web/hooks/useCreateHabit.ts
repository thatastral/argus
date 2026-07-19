"use client";

import { useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { friendlyErrorMessage } from "@/lib/formatError";

const contractsDeployed = Boolean(addresses.habitManager && addresses.penaltyEngine && addresses.argusFactory);

/// Shared on-chain createHabit() + Supabase mirror sequence — originally inlined in
/// SetupFlow.tsx, extracted once a second call site (the post-setup "+ Add Habit" flow, and
/// chat's function-calling confirm) needed the exact same logic. Keeping it in one place avoids
/// the two copies drifting, especially the fiddly bit where the mirror's contract_index must be
/// read fresh right before the on-chain call rather than assumed.
///
/// `stakeAmount` is locked into HabitManager.habitStake at creation time and never changes again
/// (see HabitManager.sol) — per a direct instruction, changing the wallet's default stake later
/// must never retroactively change what an already-created habit has at risk. There is no more
/// wallet-level "current stake"; every call site collecting a stake amount from the user (the
/// onboarding penalty step, AddHabitModal, chat's createHabit tool) now passes it straight
/// through here instead of relying on a prior configurePenalty() call.
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

  async function createHabit(
    name: string,
    stakeAmount: string,
    assetDecimals: number,
    assetSymbol: string,
    targetDays?: number | null,
    deadlineTime?: string | null,
  ): Promise<boolean> {
    if (!contractsDeployed) {
      setError("Contracts not deployed yet");
      return false;
    }
    const stakeAmountWei = parseUnits(stakeAmount || "0", assetDecimals);
    if (stakeAmountWei <= 0n) {
      setError("A stake amount is required — missing a day needs a real consequence.");
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
      // HabitManager.createHabit() itself never checks the vault can actually cover the new
      // stake — only _activeCount < MAX_HABITS and stakeAmount > 0 — so without this, a habit
      // could be created fully under-collateralized. AddHabitModal.tsx has its own inline check
      // against the same read for instant UI feedback, but that only covers its own call site;
      // this one lives here so every caller (SetupFlow, AddHabitModal, and — confirmed live as a
      // real gap — chat's createHabit tool, which had no such guard at all) is protected the
      // same way. Read fresh right before the write rather than trusting any cached balance.
      if (addresses.argusFactory) {
        const walletAddress = (await publicClient.readContract({
          address: addresses.argusFactory,
          abi: abis.argusFactory,
          functionName: "walletOf",
          args: [address],
        })) as `0x${string}`;
        if (walletAddress && walletAddress !== "0x0000000000000000000000000000000000000000") {
          const available = (await publicClient.readContract({
            address: walletAddress,
            abi: abis.accountabilityWallet,
            functionName: "availableBalance",
          })) as bigint;
          if (stakeAmountWei > available) {
            setError(
              `Exceeds your Available balance (${formatUnits(available, assetDecimals)} ${assetSymbol}) — deposit more first.`,
            );
            setBusy(false);
            return false;
          }
        }
      }

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
        args: [stakeAmountWei],
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
          isNewHabit: true,
          stakeAmountWei: stakeAmountWei.toString(),
          assetSymbol,
          assetDecimals,
        }),
      });
      if (!mirrorRes.ok) throw new Error("Habit created on-chain but failed to save — refresh and try again");

      return true;
    } catch (err) {
      if (!cancelledRef.current) setError(friendlyErrorMessage(err, "Failed to create habit on-chain"));
      return false;
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  return { createHabit, busy, error, cancel, contractsDeployed, isConnected };
}
