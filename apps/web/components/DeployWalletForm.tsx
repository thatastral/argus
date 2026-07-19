"use client";

import { useRef, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { addresses, abis, NATIVE_ASSET } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { WalletReconnect } from "./WalletReconnect";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";
import { useToast } from "./Toast";
import { friendlyErrorMessage } from "@/lib/formatError";

/// Deploy button for a user's AccountabilityWallet. Shared between SetupFlow's wallet step
/// (first-time setup) and WalletStatus's recovery path (an Easy Mode user who created a habit
/// but never finished deploying a vault — see WalletStatus for why that state is reachable and
/// needs its own way back in, not just a dead-end message).
///
/// `asset` is a required, already-decided choice — not a picker. It used to be an independently
/// changeable "defaultAsset" here, which meant a user could configure their stake in MON during
/// the penalty step and then click USDC here, deploying a vault whose real asset didn't match
/// the decimals `configurePenalty()` already parsed the stake amount with. PenaltyEngine stores
/// only a raw wei number with no unit metadata — AccountabilityWallet.committedAmount() would
/// then read that MON-scaled figure (e.g. 0.5 MON = 5e17) as if it were USDC (6 decimals), i.e.
/// 500 billion USDC, permanently clamping committedAmount() to the entire vault balance and
/// zeroing availableBalance() for good. The asset is decided once, during the penalty step
/// (SetupFlow.tsx's `vaultAsset`) or already on record in Supabase's `penalty_configs.asset_symbol`
/// (WalletStatus.tsx's recovery path) — this component only ever confirms and deploys it.
export function DeployWalletForm({
  onDeployed,
  asset: vaultAsset,
}: {
  onDeployed: () => void;
  asset: "mon" | "usdc";
}) {
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  function cancel() {
    cancelledRef.current = true;
    setBusy(false);
    setError("Cancelled — check your wallet for a stuck request, then try again.");
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
      toast("Accountability Wallet deployed");
      onDeployed();
    } catch (err) {
      if (!cancelledRef.current)
        setError(friendlyErrorMessage(err, "Failed to deploy Accountability Wallet"));
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  if (!isConnected) return <WalletReconnect />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md bg-surface px-3 py-2">
        <span className="text-sm">Funding asset</span>
        <Tooltip label="Fixed by your penalty step's choice — matches the decimals your stake amount was already parsed with, can't be changed here.">
          <span className="text-sm font-medium underline decoration-dotted">{vaultAsset === "usdc" ? "USDC" : "MON"}</span>
        </Tooltip>
      </div>

      <button
        onClick={deploy}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
      >
        {busy && <Spinner size={14} />}
        {busy ? "Confirm in wallet…" : "Deploy wallet"}
      </button>
      {busy && (
        <button onClick={cancel} className="w-full text-center text-xs text-muted underline">
          Stuck? Cancel and retry
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
