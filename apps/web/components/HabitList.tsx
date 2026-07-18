"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { useUnmirroredHabits } from "@/hooks/useUnmirroredHabits";
import { AddHabitModal } from "./AddHabitModal";
import { EditHabitModal } from "./EditHabitModal";
import { DayGroupsList, type HistoryResponse } from "./HabitDayGroups";
import { HistoryModal } from "./HistoryModal";
import { Modal } from "./Modal";
import { RecoverHabitsModal } from "./RecoverHabitsModal";

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";

const MAX_HABITS = 3; // must match HabitManager.MAX_HABITS

export function HabitList({ onChange, refreshToken }: { onChange?: () => void; refreshToken?: number }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [capNoticeOpen, setCapNoticeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<{ contractIndex: number; name: string } | null>(null);
  const [fundsNoticeOpen, setFundsNoticeOpen] = useState(false);
  const { symbol, assetDecimals, walletAddress, availableFormatted } = useAccountabilityWallet();

  // Detects a habit that succeeded on-chain but failed to mirror to Supabase (confirmed live —
  // a habit creation attempt in this exact state) — must be resolved via RecoverHabitsModal
  // before "+ Add Habit" is usable again, or a retry would create a second orphaned slot.
  // Also the source of `activeCount`: MAX_HABITS is enforced on-chain against *active* habits
  // (deactivating frees a slot — see HabitManager.createHabit()'s `_activeCount` check), and
  // there's no cheaper on-chain view for that than this hook's own habitActive() scan, so "+ Add
  // Habit" is gated on it rather than the raw lifetime habitCount().
  const { unmirrored, activeCount, recheck: recheckUnmirrored } = useUnmirroredHabits();

  const load = useCallback(async () => {
    const res = await fetch("/api/habits/history");
    if (res.ok) setData(await res.json());
  }, []);

  // refreshToken in the dependency array is what lets the nav bar's single "refresh everything"
  // button (AppHeader.tsx, wired through app/page.tsx) re-trigger this fetch from a sibling
  // component — this file has no other way to know a global refresh happened, since its data
  // fetching is entirely internal. Also fires once on mount, same as before (starts at 0/undefined).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/habits/history")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setData(json);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const stakeAmountFormatted =
    data?.stakeAmountWei != null
      ? Number(formatUnits(BigInt(data.stakeAmountWei), walletAddress ? assetDecimals : 18))
      : null;
  const stakeLabel = stakeAmountFormatted != null ? `${stakeAmountFormatted} ${walletAddress ? symbol : "MON"}` : null;

  const hasUnmirrored = Boolean(unmirrored && unmirrored.length > 0);
  const atCap = activeCount !== null && activeCount >= MAX_HABITS;
  // committedAmount() scales with active habit count (see AccountabilityWallet.sol) — adding one
  // more habit needs one more habit's worth of stake actually available, or the on-chain
  // createHabit() would succeed while leaving the vault under-collateralized for its own
  // configured consequence. Only checked once a stake is actually configured and a vault exists.
  const insufficientFunds = Boolean(
    walletAddress && stakeAmountFormatted !== null && Number(availableFormatted) < stakeAmountFormatted,
  );
  // Only truly disabled (unclickable) while activeCount is still loading (null — defaulting to 0
  // there would briefly let "+ Add Habit" appear enabled for an account already at the cap) or
  // while an unmirrored habit must be resolved first (RecoverHabitsModal, non-dismissible, is
  // already forced open in that state). At the cap or with insufficient funds, the button stays
  // clickable so tapping it can explain why via a notice modal, instead of silently doing nothing.
  const addHabitDisabled = activeCount === null || hasUnmirrored;

  return (
    <div className="w-full space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-light text-white/70">Habits</h2>
          <button
            onClick={() => {
              if (atCap) setCapNoticeOpen(true);
              else if (insufficientFunds) setFundsNoticeOpen(true);
              else setAddOpen(true);
            }}
            disabled={addHabitDisabled}
            className={`text-sm font-medium text-white/70 hover:text-foreground disabled:cursor-default disabled:opacity-40 ${PRESS_FEEDBACK}`}
          >
            + Add Habit
          </button>
        </div>
        <div className="mt-4 border-t border-border" />
      </div>

      {!data ? null : (
        <DayGroupsList
          days={data.days}
          stakeLabel={stakeLabel}
          onVerified={() => {
            load();
            onChange?.();
          }}
          onEdit={(contractIndex, name) => setEditing({ contractIndex, name })}
        />
      )}

      {data && data.days.length > 0 && (
        <button
          onClick={() => setHistoryOpen(true)}
          className={`text-sm font-medium text-muted hover:text-foreground ${PRESS_FEEDBACK}`}
        >
          View full history
        </button>
      )}

      <RecoverHabitsModal
        open={hasUnmirrored}
        habits={unmirrored ?? []}
        onSaved={() => {
          recheckUnmirrored();
          load();
          onChange?.();
        }}
      />

      <AddHabitModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          load();
          recheckUnmirrored();
          onChange?.();
        }}
      />

      <EditHabitModal
        key={editing?.contractIndex ?? "none"}
        open={editing !== null}
        onClose={() => setEditing(null)}
        contractIndex={editing?.contractIndex ?? null}
        currentName={editing?.name ?? ""}
        onSaved={load}
        onDeleted={() => {
          load();
          recheckUnmirrored();
          onChange?.();
        }}
      />

      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onVerified={() => {
          load();
          onChange?.();
        }}
      />

      <Modal open={capNoticeOpen} title="3 habits at a time" onClose={() => setCapNoticeOpen(false)}>
        <p className="text-sm text-muted">
          You&apos;ve got {MAX_HABITS} active habits already — that&apos;s the most Argus tracks at once. Tap the
          pencil icon on one of today&apos;s habits and delete it to free up a slot right away, then add your new
          one — no need to wait for tomorrow.
        </p>
      </Modal>

      <Modal open={fundsNoticeOpen} title="Not enough available balance" onClose={() => setFundsNoticeOpen(false)}>
        <p className="text-sm text-muted">
          Another habit needs {stakeLabel} available to cover its stake — you currently have{" "}
          {Number(availableFormatted).toFixed(4)} {walletAddress ? symbol : "MON"} available. Deposit more from the
          Wallet modal, then try again.
        </p>
      </Modal>
    </div>
  );
}
