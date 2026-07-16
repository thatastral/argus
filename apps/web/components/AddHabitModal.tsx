"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
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
  const toast = useToast();
  const [name, setName] = useState("");
  const [targetDays, setTargetDays] = useState<number | null>(null);
  const [deadlineTime, setDeadlineTime] = useState<string | null>(null);

  async function submit() {
    const ok = await createHabit(name, targetDays, deadlineTime);
    if (ok) {
      toast(`"${name}" was created`);
      setName("");
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

        <HabitDurationPicker value={targetDays} onChange={setTargetDays} />
        <HabitDeadlineTimePicker value={deadlineTime} onChange={setDeadlineTime} />

        {isConnected ? (
          <>
            <button
              onClick={submit}
              disabled={busy || !name.trim()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
            >
              {busy && <Spinner size={14} />}
              {busy ? "Confirm in wallet…" : "Create habit"}
            </button>
            {busy && (
              <button onClick={cancel} className="w-full text-center text-xs text-muted underline">
                Stuck? Cancel and try again
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
