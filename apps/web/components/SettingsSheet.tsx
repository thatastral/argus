"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { PENALTY_TYPES, PENALTY_TYPE_LABEL, type PenaltyType } from "@/lib/penalty";
import { useSetPenaltyType } from "@/hooks/useSetPenaltyType";
import { useToast } from "./Toast";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { WalletReconnect } from "./WalletReconnect";
import { friendlyErrorMessage } from "@/lib/formatError";

interface CurrentPenalty {
  penalty_type: PenaltyType;
}

/// Also reachable via chat now (see lib/gemini.ts's setPenaltyType tool /
/// hooks/useSetPenaltyType.ts) — both this sheet and the chat-confirm flow call the exact same
/// hook, so "change my consequence" from either surface behaves identically. No stake-amount
/// field here anymore — each habit locks in its own stake at creation (see
/// hooks/useCreateHabit.ts, AddHabitModal.tsx) and it never changes again, per a direct
/// instruction that changing a default later must never retroactively change an already-created
/// habit's exposure. This only ever changes the consequence type now.
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
  const { setPenaltyType: writePenaltyType, busy, error: penaltyWriteError } = useSetPenaltyType();
  const toast = useToast();

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
  const [confirming, setConfirming] = useState(false);
  const [penaltyError, setPenaltyError] = useState<string | null>(null);

  // One "Save Settings" button now covers both fields (they used to have independent Save
  // controls) — but the two underlying operations stay genuinely different: name is a plain,
  // instant off-chain write; penalty type is an on-chain configurePenalty() write that still
  // needs its own explicit "this changes what's enforced on-chain" confirmation. Dirty tracking
  // against the original snapshot decides which path a click takes.
  const nameDirty = displayName.trim() !== initialDisplayName.trim() && displayName.trim().length > 0;
  const penaltyDirty = penaltyType !== (currentPenalty?.penalty_type ?? "savingsVault");
  const dirty = nameDirty || penaltyDirty;
  const savingAny = savingName || busy;
  const saveDisabled = !dirty || savingAny;

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
      setNameError(friendlyErrorMessage(err, "Could not save display name"));
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
  // a partial success (e.g. name saved, type write rejected) is still visible to the user
  // instead of reading as "nothing happened."
  async function handleConfirmedSave() {
    setPenaltyError(null);
    const nameOk = nameDirty ? await saveNameOnly() : true;
    const penaltyOk = await writePenaltyType(penaltyType);
    if (!penaltyOk) setPenaltyError(penaltyWriteError ?? "Failed to update consequence");
    setConfirming(false);
    if (nameOk && penaltyOk) {
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
          <Tooltip label="Applies to any habit's stake, whatever it was set to when you created it.">
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
          <p className="text-xs text-muted">A missed habit&apos;s stake locks in Savings Vault — still yours, released later.</p>
        ) : (
          <p className="text-xs text-muted">A missed habit&apos;s stake goes to Argus, immediately.</p>
        )}
        <p className="text-xs text-muted">
          Each habit&apos;s own stake is set when you create it, and can&apos;t change afterward —
          this only decides what happens to it if a day is missed.
        </p>
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
          (nameDirty ? "Your name will update, and missing a day " : "Missing a day ") +
          `will trigger ${PENALTY_TYPE_LABEL[penaltyType]}${
            penaltyType === "donate" && donationAddress
              ? ` (${donationAddress.slice(0, 6)}…${donationAddress.slice(-4)})`
              : ""
          } for any habit's stake.`
        }
        confirmLabel="Confirm"
        pending={busy || savingName}
        onConfirm={handleConfirmedSave}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
