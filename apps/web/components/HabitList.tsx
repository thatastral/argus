"use client";

import { useCallback, useEffect, useState } from "react";
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

  const hasUnmirrored = Boolean(unmirrored && unmirrored.length > 0);
  const atCap = activeCount !== null && activeCount >= MAX_HABITS;
  // Only truly disabled (unclickable) while activeCount is still loading (null — defaulting to 0
  // there would briefly let "+ Add Habit" appear enabled for an account already at the cap) or
  // while an unmirrored habit must be resolved first (RecoverHabitsModal, non-dismissible, is
  // already forced open in that state). At the cap, the button stays clickable so tapping it can
  // explain why via a notice modal, instead of silently doing nothing. There's no more
  // pre-emptive "insufficient funds" check here — each habit's stake is now chosen fresh inside
  // AddHabitModal itself (not a known wallet-level amount ahead of time), which validates that
  // inline instead.
  const addHabitDisabled = activeCount === null || hasUnmirrored;

  return (
    <div className="w-full space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-light text-white/70">Habits</h2>
          <button
            onClick={() => (atCap ? setCapNoticeOpen(true) : setAddOpen(true))}
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
          You have {MAX_HABITS} active habits — the max Argus tracks. Tap the pencil on a habit and delete it to free a slot, then add your new one.
        </p>
      </Modal>
    </div>
  );
}
