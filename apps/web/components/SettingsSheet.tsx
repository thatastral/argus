"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { PENALTY_TYPES, PENALTY_TYPE_LABEL, type PenaltyType } from "@/lib/penalty";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { useUnmirroredHabits } from "@/hooks/useUnmirroredHabits";
import { useSetStake } from "@/hooks/useSetStake";
import { useToast } from "./Toast";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { WalletReconnect } from "./WalletReconnect";

interface CurrentPenalty {
  penalty_type: PenaltyType;
  amount_wei: string;
  asset_symbol: string | null;
  asset_decimals: number | null;
}

/// Also reachable via chat now (see lib/gemini.ts's setStake tool / hooks/useSetStake.ts) — both
/// this sheet and the chat-confirm flow call the exact same hook, so "change my stake" from
/// either surface behaves identically.
export function SettingsSheet({
  displayName: initialDisplayName,
  currentPenalty,
  onSaved,
}: {
  displayName: string;
  currentPenalty: CurrentPenalty | null;
  onSaved: () => void;
}) {
  const { isConnected } = useAccount();
  const { setStake, busy, error: stakeError } = useSetStake();
  const { symbol, assetDecimals, walletAddress, balancesLoading } = useAccountabilityWallet();
  const { activeCount } = useUnmirroredHabits();
  const toast = useToast();

  // A deployed vault is authoritative for the real asset. Before one exists yet (mid-setup), or
  // while its asset/decimals read is still resolving (balancesLoading — confirmed live as the
  // source of a briefly wildly-wrong displayed number on a cold first load, since assetDecimals
  // defaults to 6 until the real value is known), the only source of truth is whatever was
  // persisted at configure-time (migration 0002's asset_symbol/asset_decimals) — falls back to
  // that rather than trusting a possibly-still-guessed value. See CLAUDE.md gotcha.
  const resolvedSymbol = walletAddress && !balancesLoading ? symbol : (currentPenalty?.asset_symbol ?? "MON");
  const resolvedDecimals = walletAddress && !balancesLoading ? assetDecimals : (currentPenalty?.asset_decimals ?? 18);

  const { data: donationAddressData } = useReadContract({
    address: addresses.penaltyEngine,
    abi: abis.penaltyEngine,
    functionName: "donationAddress",
    chainId: activeChain.id,
    query: { enabled: Boolean(addresses.penaltyEngine) },
  });
  const donationAddress = donationAddressData as `0x${string}` | undefined;

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [penaltyType, setPenaltyType] = useState<PenaltyType>(currentPenalty?.penalty_type ?? "savingsVault");
  const initialStakeAmount = currentPenalty ? formatUnits(BigInt(currentPenalty.amount_wei), resolvedDecimals) : "0.01";
  const [stakeAmount, setStakeAmount] = useState(initialStakeAmount);
  const [confirming, setConfirming] = useState(false);
  const [penaltyError, setPenaltyError] = useState<string | null>(null);

  // One "Save Settings" button now covers both fields (they used to have independent Save
  // controls) — but the two underlying operations stay genuinely different: name is a plain,
  // instant off-chain write; stake/penalty-type is an on-chain configurePenalty() write that
  // still needs its own explicit "this changes what's enforced on-chain" confirmation. Dirty
  // tracking against the original snapshot decides which path a click takes.
  const nameDirty = displayName.trim() !== initialDisplayName.trim() && displayName.trim().length > 0;
  const penaltyDirty = penaltyType !== (currentPenalty?.penalty_type ?? "savingsVault") || stakeAmount !== initialStakeAmount;
  const dirty = nameDirty || penaltyDirty;

  const stakeMissing = !stakeAmount || Number(stakeAmount) <= 0;
  const penaltyValid = stakeAmount && !Number.isNaN(Number(stakeAmount)) && !stakeMissing;
  const savingAny = savingName || busy;
  const saveDisabled = !dirty || savingAny || (penaltyDirty && !penaltyValid);

  // Returns success/failure rather than calling onSaved itself — the two call sites below decide
  // when the overall save sequence is done and it's safe to close the sheet.
  async function saveNameOnly(): Promise<boolean> {
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      if (!res.ok) throw new Error("Could not save display name");
      return true;
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Could not save display name");
      return false;
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveSettings() {
    if (penaltyDirty) {
      setConfirming(true);
      return;
    }
    const ok = await saveNameOnly();
    if (ok) {
      toast("Settings saved");
      onSaved();
    }
  }

  // Name saves first, before the wallet-signature prompt below it — so if the signature is
  // rejected or cancelled, an already-valid name change isn't lost along with it. Each operation
  // keeps its own error (`nameError`/`penaltyError`) rather than collapsing into one message, so
  // a partial success (e.g. name saved, stake write rejected) is still visible to the user
  // instead of reading as "nothing happened."
  async function handleConfirmedSave() {
    setPenaltyError(null);
    const nameOk = nameDirty ? await saveNameOnly() : true;
    const stakeOk = await setStake(stakeAmount, penaltyType, resolvedSymbol, resolvedDecimals);
    if (!stakeOk) setPenaltyError(stakeError ?? "Failed to update stake");
    setConfirming(false);
    if (nameOk && stakeOk) {
      toast("Settings saved");
      onSaved();
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label className="block text-sm font-medium text-white/70">Display name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-md bg-surface px-3 py-2 text-sm"
        />
        {nameError && <p className="text-xs text-red-500">{nameError}</p>}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-1.5">
          <label className="block text-sm font-medium text-white/70">If you miss a day</label>
          <Tooltip label="Only your configured stake is ever affected — the rest of your wallet balance always stays freely withdrawable.">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-surface text-[10px] text-muted">?</span>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PENALTY_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setPenaltyType(type)}
              className={`relative rounded-md px-3 py-2 text-left text-sm transition-transform duration-150 ease-emil-out active:scale-[0.97] ${
                penaltyType === type ? "bg-foreground text-background" : "bg-surface"
              }`}
            >
              {PENALTY_TYPE_LABEL[type]}
              {type === "savingsVault" && (
                <span
                  className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[10px] font-normal ${
                    penaltyType === "savingsVault" ? "bg-background/20 opacity-70" : "bg-background text-muted"
                  }`}
                >
                  Recommended
                </span>
              )}
              {type === "donate" && donationAddress && (
                <span
                  className={`mt-1 block w-fit rounded-full px-2 py-0.5 font-mono text-[10px] font-normal ${
                    penaltyType === "donate" ? "bg-background/20 opacity-70" : "bg-background text-muted"
                  }`}
                >
                  {donationAddress.slice(0, 6)}…{donationAddress.slice(-4)}
                </span>
              )}
            </button>
          ))}
        </div>
        {penaltyType === "savingsVault" ? (
          <p className="text-xs text-muted">
            A missed day moves your stake into a locked Savings Vault — still yours, released once the lock
            period passes.
          </p>
        ) : (
          <p className="text-xs text-muted">A missed day sends your stake to Argus, immediately.</p>
        )}

        <label className="block text-sm font-medium text-white/70">Amount at stake per habit, per missed day</label>
        <div className="flex gap-2">
          <input
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            inputMode="decimal"
            className="flex-1 rounded-md bg-surface px-3 py-2 text-sm"
          />
          <span className="flex items-center rounded-md bg-surface px-3 text-xs text-muted">{resolvedSymbol}</span>
        </div>
        {!walletAddress && !currentPenalty?.asset_symbol && (
          <p className="text-xs text-muted">
            No vault deployed yet — this will be denominated in whichever asset your Accountability Wallet ends up
            holding.
          </p>
        )}
        {activeCount !== null && activeCount > 0 && stakeAmount && !Number.isNaN(Number(stakeAmount)) && (
          <p className="text-xs text-muted">
            Charged per habit — with {activeCount} active habit{activeCount === 1 ? "" : "s"}, up to{" "}
            {(Number(stakeAmount) * activeCount).toFixed(4)} {resolvedSymbol} could be Committed at once if you
            missed all of them the same day.
          </p>
        )}
        {stakeMissing && (
          <p className="text-xs text-red-500">A stake amount is required — missing a day needs a real consequence.</p>
        )}
        {penaltyError && <p className="text-xs text-red-500">{penaltyError}</p>}
      </section>

      {penaltyDirty && !isConnected ? (
        <WalletReconnect />
      ) : (
        <button
          onClick={handleSaveSettings}
          disabled={saveDisabled}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
        >
          {savingAny && <Spinner size={14} />}
          {savingAny ? "Saving…" : "Save Settings"}
        </button>
      )}

      <ConfirmDialog
        open={confirming}
        title="Update settings"
        description={
          (nameDirty ? "Your display name will be updated, and " : "") +
          `if you miss a day, ${PENALTY_TYPE_LABEL[penaltyType]} will apply — ${stakeAmount} ${resolvedSymbol}${
            penaltyType === "donate" && donationAddress
              ? ` (${donationAddress.slice(0, 6)}…${donationAddress.slice(-4)})`
              : ""
          }. This changes what's enforced on-chain.`
        }
        confirmLabel="Confirm"
        pending={busy || savingName}
        onConfirm={handleConfirmedSave}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
