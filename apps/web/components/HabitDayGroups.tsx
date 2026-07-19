"use client";

import { useState } from "react";
import { CaretRight, ListChecks, PencilSimple } from "@phosphor-icons/react";
import { useCountdownToMidnight } from "@/hooks/useCountdownToMidnight";
import { useCountdownToDeadline, computeCountdown } from "@/hooks/useCountdownToDeadline";
import { LiveCameraCapture } from "./LiveCameraCapture";

export interface DayHabit {
  contractIndex: number;
  name: string;
  verified: boolean;
  targetDays: number | null;
  daysRemaining: number | null;
  deadlineTime: string | null;
}

export interface DayGroup {
  day: string;
  isToday: boolean;
  habits: DayHabit[];
}

export interface HistoryResponse {
  days: DayGroup[];
  stakeAmountWei: string | null;
  penaltyType: string | null;
}

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";
// Hidden until row-hover on desktop (default visible — there's no reliable hover on touch, and
// hiding a primary CTA behind a gesture that doesn't exist there would make it unreachable).
const HOVER_REVEAL = "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100";

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function dayLabel(dayStr: string, isToday: boolean) {
  if (isToday) return "Today";
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (dayStr === yesterday) return "Yesterday";
  return new Date(`${dayStr}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function TodayStatusPill() {
  const countdown = useCountdownToMidnight();
  return <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-warning">{countdown}</span>;
}

function PastStatusPill({ allCompleted }: { allCompleted: boolean }) {
  return (
    <span
      className={`rounded-full bg-surface px-3 py-1 text-xs font-medium ${allCompleted ? "text-success" : "text-warning"}`}
    >
      {allCompleted ? "Completed" : "Missed"}
    </span>
  );
}

function HabitRow({
  habit,
  isToday,
  stakeLabel,
  onVerified,
  onEdit,
}: {
  habit: DayHabit;
  isToday: boolean;
  stakeLabel: string | null;
  onVerified: () => void;
  onEdit?: () => void;
}) {
  const [capturing, setCapturing] = useState(false);

  // Own live countdown to this habit's daily deadline (only ticks for today's incomplete row —
  // a self-discipline nudge, not a real on-chain cutoff; see useCountdownToDeadline.ts). Once it
  // passes, the action button swaps to "Missed" — still purely a UI signal, the actual stake
  // stays safe until the real UTC-midnight settlement, unchanged.
  const deadline = useCountdownToDeadline(isToday && !habit.verified ? habit.deadlineTime : null);
  const missedDeadline = isToday && !habit.verified && deadline.passed;
  const showUpload = isToday && !habit.verified && !missedDeadline;
  const showLiveCountdown = showUpload && deadline.label !== null;
  // A past day's unverified habit is just as "missed" as today's deadline-passed case — it used
  // to fall through to the same disabled gray "Complete" pill as an actually-verified habit,
  // which is what made a day tagged "Missed" show every habit looking identically done.
  const showMissed = missedDeadline || (!isToday && !habit.verified);

  // One compact line instead of a growing stack — the live countdown (when shown) already
  // covers the deadline, so it isn't repeated here.
  const metaParts: string[] = [];
  if (stakeLabel) metaParts.push(stakeLabel);
  if (habit.targetDays !== null) {
    metaParts.push(
      habit.daysRemaining !== null && habit.daysRemaining > 0
        ? `${habit.daysRemaining}d left`
        : "commitment complete",
    );
  }
  if (habit.deadlineTime !== null && !showLiveCountdown) {
    metaParts.push(`Due ${formatTime12h(habit.deadlineTime)}`);
  }
  const metaLine = metaParts.join(" · ");

  return (
    <div className={`group flex items-center justify-between gap-4 py-1 ${habit.verified ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1 pr-2">
        <p className="truncate text-base font-medium" title={habit.name}>
          {habit.name}
        </p>
        {metaLine && (
          <p className="truncate text-xs text-white/60" title={metaLine}>
            {metaLine}
          </p>
        )}
        {/* Moved down onto its own line, under the title/meta, rather than sitting in the
            shrink-0 action row on the right — it used to eat into that row's fixed width and
            truncate the title on narrower screens (confirmed live on mobile). */}
        {showLiveCountdown && (
          <p className="truncate text-xs font-medium text-warning">{deadline.label}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {showUpload ? (
          <button
            onClick={() => setCapturing(true)}
            className={`shrink-0 rounded-full bg-surface px-3 py-2 text-sm font-light text-white/70 sm:px-4 sm:py-3 ${PRESS_FEEDBACK} ${HOVER_REVEAL}`}
          >
            Upload Proof
          </button>
        ) : showMissed ? (
          <span className="shrink-0 cursor-default rounded-full bg-surface px-3 py-2 text-sm font-light text-warning sm:px-4 sm:py-3">
            Missed
          </span>
        ) : (
          <button
            disabled
            className="shrink-0 cursor-default rounded-full bg-surface px-3 py-2 text-sm font-light text-white/15 sm:px-4 sm:py-3"
          >
            Complete
          </button>
        )}

        {/* A completed habit can't be edited/renamed/deactivated for the day — once it's
            verified, renaming it would be confusing (no way to tell which name applied when it
            was proved) and there's nothing left to "fix" about it today anyway. */}
        {isToday && onEdit && !habit.verified && (
          <button
            onClick={onEdit}
            aria-label="Edit habit"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted hover:text-foreground ${PRESS_FEEDBACK} ${HOVER_REVEAL}`}
          >
            <PencilSimple size={14} weight="bold" />
          </button>
        )}
      </div>

      {capturing && (
        <LiveCameraCapture
          contractIndex={habit.contractIndex}
          habitName={habit.name}
          onClose={() => setCapturing(false)}
          onVerified={onVerified}
        />
      )}
    </div>
  );
}

/// Shared day-grouped habit rendering for both the home screen's short window
/// (HabitList.tsx) and the full-range history view (HistoryModal.tsx) — kept in one place so
/// the collapse behavior and per-day pill/row logic can't drift between the two. Every group
/// except today's starts collapsed; today is always expanded and un-toggleable.
export function DayGroupsList({
  days,
  stakeLabel,
  onVerified,
  onEdit,
}: {
  days: DayGroup[];
  stakeLabel: string | null;
  onVerified: () => void;
  onEdit?: (contractIndex: number, name: string) => void;
}) {
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());

  function toggle(day: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  if (days.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface py-10 text-center">
        <ListChecks size={22} weight="fill" className="text-muted" />
        <p className="text-sm text-muted">No habits yet — add one below to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {days.map((group) => {
        const allCompleted = group.habits.length > 0 && group.habits.every((h) => h.verified);
        // Today specifically: once every habit is individually resolved (verified, or its own
        // deadline has passed — computeCountdown is the plain, non-hook version of the same
        // per-row logic HabitRow uses live, safe to call in this .every() loop), stop the
        // countdown and reflect Completed/Missed instead of waiting for real midnight. A habit
        // with no deadlineTime set can only ever resolve via `verified`, so if any active habit
        // lacks one and isn't done, the day keeps counting down regardless of the others —
        // there's nothing else that could resolve it early.
        const allResolvedToday =
          group.isToday &&
          group.habits.length > 0 &&
          group.habits.every((h) => h.verified || (h.deadlineTime !== null && computeCountdown(h.deadlineTime).passed));
        const isOpen = group.isToday || openDays.has(group.day);
        return (
          <div key={group.day} className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => toggle(group.day)}
                disabled={group.isToday}
                className={`flex items-center gap-2 text-sm font-medium text-white/38 disabled:cursor-default ${PRESS_FEEDBACK}`}
              >
                {!group.isToday && (
                  <CaretRight
                    size={12}
                    weight="bold"
                    className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                )}
                {dayLabel(group.day, group.isToday)}
              </button>
              {group.isToday && !allResolvedToday ? <TodayStatusPill /> : <PastStatusPill allCompleted={allCompleted} />}
            </div>
            {/* Fainter than the divider under the "Habits" section header (HabitList.tsx) —
                this one repeats once per day and shouldn't compete with that single, more
                prominent section-level rule. */}
            <div className="border-t border-white/10" />
            {isOpen && (
              <div className="space-y-4">
                {group.habits.map((habit) => (
                  <HabitRow
                    key={habit.contractIndex}
                    habit={habit}
                    isToday={group.isToday}
                    stakeLabel={stakeLabel}
                    onVerified={onVerified}
                    onEdit={
                      group.isToday && onEdit ? () => onEdit(habit.contractIndex, habit.name) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
