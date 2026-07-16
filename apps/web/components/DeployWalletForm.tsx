"use client";

import { useRef, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { addresses, abis, NATIVE_ASSET } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { WalletReconnect } from "./WalletReconnect";

/// Asset choice + deploy button for a user's AccountabilityWallet. Shared between SetupFlow's
/// wallet step (first-time setup) and WalletStatus's recovery path (an Easy Mode user who
/// created a habit but never finished deploying a vault — see WalletStatus for why that state
/// is reachable and needs its own way back in, not just a dead-end message).
export function DeployWalletForm({
  onDeployed,
  defaultAsset = "mon",
}: {
  onDeployed: () => void;
  defaultAsset?: "mon" | "usdc";
}) {
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [vaultAsset, setVaultAsset] = useState<"mon" | "usdc">(defaultAsset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  function cancel() {
    cancelledRef.current = true;
    setBusy(false);
    setError("Cancelled — check your wallet extension for a stuck request, then try again.");
  }

  async function deploy() {
    if (vaultAsset === "usdc" && !addresses.usdc) {
      setError("NEXT_PUBLIC_USDC_ADDRESS is not configured");
      return;
    }
    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    try {
      await writeContractAsync({
        address: addresses.argusFactory!,
        abi: abis.argusFactory,
        functionName: "deployWallet",
        args: [vaultAsset === "usdc" ? addresses.usdc! : NATIVE_ASSET],
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return;
      onDeployed();
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to deploy Accountability Wallet");
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  if (!isConnected) return <WalletReconnect />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setVaultAsset("mon")}
          className={`rounded-md border px-3 py-2 text-sm ${
            vaultAsset === "mon" ? "border-foreground bg-surface" : "border-border"
          }`}
        >
          MON
        </button>
        <button
          onClick={() => setVaultAsset("usdc")}
          disabled={!addresses.usdc}
          className={`rounded-md border px-3 py-2 text-sm disabled:opacity-40 ${
            vaultAsset === "usdc" ? "border-foreground bg-surface" : "border-border"
          }`}
        >
          USDC
        </button>
      </div>

      <button
        onClick={deploy}
        disabled={busy}
        className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
      >
        {busy ? "Confirm in wallet…" : "Deploy wallet"}
      </button>
      {busy && (
        <button onClick={cancel} className="w-full text-center text-xs text-muted underline">
          Stuck? Cancel and try again
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
