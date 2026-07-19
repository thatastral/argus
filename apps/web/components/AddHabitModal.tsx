"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { useCreateHabit } from "@/hooks/useCreateHabit";
import { HabitDurationPicker } from "./HabitDurationPicker";
import { HabitDeadlineTimePicker } from "./HabitDeadlineTimePicker";
import { WalletReconnect } from "./WalletReconnect";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { useToast } from "./Toast";

export function AddHabitModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { isConnected } = useAccount();
  const { createHabit, busy, error, cancel } = useCreateHabit();
  const { symbol, assetDecimals, availableFormatted } = useAccountabilityWallet();
  const toast = useToast();
  const [name, setName] = useState("");
  // No default carried over from a prior habit or a wallet-level setting — each habit locks in
  // its own stake at creation (see useCreateHabit.ts) and never changes again, so this is always
  // a fresh, deliberate choice rather than something pre-filled from elsewhere.
  const [stakeAmount, setStakeAmount] = useState("");
  const [targetDays, setTargetDays] = useState<number | null>(null);
  const [deadlineTime, setDeadlineTime] = useState<string | null>(null);

  const stakeMissing = !stakeAmount || Number(stakeAmount) <= 0;
  const exceedsAvailable = !stakeMissing && Number(stakeAmount) > Number(availableFormatted);

  async function submit() {
    const ok = await createHabit(name, stakeAmount, assetDecimals, symbol, targetDays, deadlineTime);
    if (ok) {
      toast(`"${name}" was created`);
      setName("");
      setStakeAmount("");
      setTargetDays(null);
      setDeadlineTime(null);
      onCreated();
      onClose();
    }
  }

  return (
    <Modal open={open} title="Add habit" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-white/70">Habit name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Code, Gym, Read"
          className="w-full rounded-md bg-surface px-3 py-2 text-sm"
        />

        <label className="block text-sm font-medium text-white/70">Amount at stake if you miss a day</label>
        <div className="flex gap-2">
          <input
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.01"
            className="flex-1 rounded-md bg-surface px-3 py-2 text-sm"
          />
          <span className="flex items-center rounded-md bg-surface px-3 text-xs text-muted">{symbol}</span>
        </div>
        <p className="text-xs text-muted">
          Available: {Number(availableFormatted).toFixed(4)} {symbol}. This habit&apos;s stake is locked in now and can&apos;t
          change later — deactivate and re-create it to use a different amount.
        </p>
        {stakeMissing && stakeAmount !== "" && (
          <p className="text-xs text-red-500">A stake amount is required — missing a day needs a real consequence.</p>
        )}
        {exceedsAvailable && (
          <p className="text-xs text-red-500">
            Exceeds your Available balance ({Number(availableFormatted).toFixed(4)} {symbol}) — deposit more from Wallet first.
          </p>
        )}

        <HabitDurationPicker value={targetDays} onChange={setTargetDays} />
        <HabitDeadlineTimePicker value={deadlineTime} onChange={setDeadlineTime} />

        {isConnected ? (
          <>
            <button
              onClick={submit}
              disabled={busy || !name.trim() || stakeMissing || exceedsAvailable}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
            >
              {busy && <Spinner size={14} />}
              {busy ? "Confirm in wallet…" : "Create habit"}
            </button>
            {busy && (
              <button onClick={cancel} className="w-full text-center text-xs text-muted underline">
                Stuck? Cancel and retry
              </button>
            )}
          </>
        ) : (
          <WalletReconnect />
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
