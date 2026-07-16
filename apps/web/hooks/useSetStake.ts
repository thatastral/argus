"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { PENALTY_TYPE_INDEX, type PenaltyType } from "@/lib/penalty";
import { useAccountabilityWallet } from "./useAccountabilityWallet";

/// Shared configurePenalty() + Supabase mirror sequence — extracted out of SettingsSheet.tsx
/// once chat's function-calling needed the exact same logic for a "commit"/"stake" action
/// (previously the only way to change the per-habit stake was this settings sheet; asking the
/// coach to "commit 0.5 MON" had no tool to call, so it silently misrouted onto `deposit`, which
/// only adds to Available and never touches the actual stake).
export function useSetStake() {
  const { writeContractAsync } = useWriteContract();
  const { walletAddress, assetDecimals, symbol, balancesLoading } = useAccountabilityWallet();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /// `fallbackSymbol`/`fallbackDecimals` are whatever the caller already knows (e.g. a prior
  /// penalty_configs row) — used only when no deployed vault's live asset read has resolved yet,
  /// same precedence SettingsSheet.tsx's `resolvedSymbol`/`resolvedDecimals` already apply.
  async function setStake(
    amountStr: string,
    penaltyType: PenaltyType,
    fallbackSymbol: string,
    fallbackDecimals: number,
  ): Promise<boolean> {
    if (!addresses.penaltyEngine) {
      setError("Contracts not deployed yet");
      return false;
    }

    const resolvedDecimals = walletAddress && !balancesLoading ? assetDecimals : fallbackDecimals;
    const resolvedSymbol = walletAddress && !balancesLoading ? symbol : fallbackSymbol;

    setBusy(true);
    setError(null);
    try {
      const amountWei = parseUnits(amountStr || "0", resolvedDecimals);

      await writeContractAsync({
        address: addresses.penaltyEngine,
        abi: abis.penaltyEngine,
        functionName: "configurePenalty",
        args: [PENALTY_TYPE_INDEX[penaltyType], amountWei],
        chainId: activeChain.id,
      });

      const mirrorRes = await fetch("/api/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          penaltyType,
          amountWei: amountWei.toString(),
          assetSymbol: resolvedSymbol,
          assetDecimals: resolvedDecimals,
        }),
      });
      if (!mirrorRes.ok) throw new Error("Stake updated on-chain but failed to save — refresh and try again");

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update stake");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { setStake, busy, error };
}
