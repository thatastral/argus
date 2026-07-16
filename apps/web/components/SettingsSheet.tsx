"use client";

import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { PENALTY_TYPES, PENALTY_TYPE_INDEX, PENALTY_TYPE_LABEL, type PenaltyType } from "@/lib/penalty";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { ConfirmDialog } from "./ConfirmDialog";
import { WalletReconnect } from "./WalletReconnect";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

interface CurrentPenalty {
  penalty_type: PenaltyType;
  partner_address: string | null;
  amount_wei: string;
}

/// PRD lists "change penalty" as a supported chat action, but the chat coach here is
/// read-only (progressCoachReply never triggers writes — see lib/gemini.ts). Until an
/// agentic chat flow exists, this traditional-UI settings sheet is how that actually happens.
export function SettingsSheet({
  displayName: initialDisplayName,
  walletMode,
  currentPenalty,
  onSaved,
}: {
  displayName: string;
  walletMode: string | undefined;
  currentPenalty: CurrentPenalty | null;
  onSaved: () => void;
}) {
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { symbol, assetDecimals, walletAddress } = useAccountabilityWallet();

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [penaltyType, setPenaltyType] = useState<PenaltyType>(currentPenalty?.penalty_type ?? "save");
  const [partnerAddress, setPartnerAddress] = useState(currentPenalty?.partner_address ?? "");
  const [stakeAmount, setStakeAmount] = useState(
    currentPenalty ? formatUnits(BigInt(currentPenalty.amount_wei), walletAddress ? assetDecimals : 18) : "0.01",
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [penaltyError, setPenaltyError] = useState<string | null>(null);

  async function saveName() {
    if (!displayName.trim()) return;
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      if (!res.ok) throw new Error("Could not save display name");
      onSaved();
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Could not save display name");
    } finally {
      setSavingName(false);
    }
  }

  async function savePenalty() {
    setBusy(true);
    setPenaltyError(null);
    try {
      const decimals = walletAddress ? assetDecimals : 18;
      const amountWei = parseUnits(stakeAmount || "0", decimals);
      const partner =
        penaltyType === "partner" ? (partnerAddress as `0x${string}`) : "0x0000000000000000000000000000000000000000";

      await writeContractAsync({
        address: addresses.penaltyEngine!,
        abi: abis.penaltyEngine,
        functionName: "configurePenalty",
        args: [PENALTY_TYPE_INDEX[penaltyType], partner, amountWei],
        chainId: activeChain.id,
      });

      const mirrorRes = await fetch("/api/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          penaltyType,
          partnerAddress: penaltyType === "partner" ? partnerAddress : undefined,
          amountWei: amountWei.toString(),
        }),
      });
      if (!mirrorRes.ok) throw new Error("Penalty updated on-chain but failed to save — refresh and try again");
      onSaved();
    } catch (err) {
      setPenaltyError(err instanceof Error ? err.message : "Failed to update penalty");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const penaltyValid =
    (penaltyType !== "partner" || ADDRESS_PATTERN.test(partnerAddress)) && stakeAmount && !Number.isNaN(Number(stakeAmount));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label className="block text-sm font-medium">Display name</label>
        <div className="flex gap-2">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={saveName}
            disabled={savingName || !displayName.trim() || displayName === initialDisplayName}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            {savingName ? "Saving…" : "Save"}
          </button>
        </div>
        {nameError && <p className="text-xs text-red-500">{nameError}</p>}
      </section>

      <section className="space-y-1">
        <label className="block text-sm font-medium">Wallet mode</label>
        <p className="text-sm capitalize">{walletMode ?? "easy"} Mode</p>
        <p className="text-xs text-muted">
          {walletMode === "hard"
            ? "Spending happens directly from your own wallet — enforcement needs the Chrome Extension, not built in this scaffold yet."
            : "Argus holds funds in a vault only you own; withdrawals unlock once today's habits are verified."}
        </p>
      </section>

      <section className="space-y-3">
        <label className="block text-sm font-medium">If you miss a day</label>
        <div className="grid grid-cols-2 gap-2">
          {PENALTY_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setPenaltyType(type)}
              className={`rounded-md border px-3 py-2 text-sm capitalize ${
                penaltyType === type ? "border-foreground bg-surface" : "border-border"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
        {penaltyType === "partner" && (
          <>
            <input
              value={partnerAddress}
              onChange={(e) => setPartnerAddress(e.target.value)}
              placeholder="Partner's wallet address (0x…)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            {partnerAddress && !ADDRESS_PATTERN.test(partnerAddress) && (
              <p className="text-xs text-red-500">Not a valid address — expected 0x followed by 40 hex characters.</p>
            )}
          </>
        )}

        <label className="block text-sm font-medium">Amount at stake per missed day</label>
        <div className="flex gap-2">
          <input
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            inputMode="decimal"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <span className="flex items-center rounded-md border border-border px-3 text-xs text-muted">
            {walletAddress ? symbol : "MON"}
          </span>
        </div>
        {!walletAddress && (
          <p className="text-xs text-muted">
            No vault deployed yet — this will be denominated in whichever asset your Accountability Wallet ends up
            holding.
          </p>
        )}
        {penaltyType !== "save" && (!stakeAmount || Number(stakeAmount) === 0) && (
          <p className="text-xs text-amber-500">With nothing staked, missing a day won&apos;t have a consequence.</p>
        )}

        {isConnected ? (
          <>
            <button
              onClick={() => setConfirming(true)}
              disabled={busy || !penaltyValid}
              className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
            >
              Update penalty
            </button>
            {penaltyError && <p className="text-xs text-red-500">{penaltyError}</p>}
          </>
        ) : (
          <WalletReconnect />
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        title="Update penalty"
        description={`If you miss a day, ${PENALTY_TYPE_LABEL[penaltyType]} will apply${
          penaltyType === "save" ? "" : ` — ${stakeAmount} ${walletAddress ? symbol : "MON"}`
        }. This changes what's enforced on-chain.`}
        confirmLabel="Confirm"
        pending={busy}
        onConfirm={savePenalty}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
