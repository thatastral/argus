"use client";

import { useEffect, useState } from "react";

export interface DeadlineCountdown {
  label: string | null;
  passed: boolean;
}

/// Exported (not just used internally) so day-group-level aggregation (HabitDayGroups.tsx)
/// can check "has this habit's deadline passed" as a plain calculation — a React hook can't be
/// called once per item in a .every()/.some() loop, so that aggregation needs the underlying
/// math directly, without the ticking-interval machinery below.
export function computeCountdown(deadlineTime: string | null): DeadlineCountdown {
  if (!deadlineTime) return { label: null, passed: false };

  const [h, m] = deadlineTime.split(":").map(Number);
  const now = new Date();
  const deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  const ms = deadline.getTime() - now.getTime();

  if (ms <= 0) return { label: null, passed: true };

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { label: `${pad(hours)}H:${pad(minutes)}M:${pad(seconds)}S`, passed: false };
}

/// Live countdown to a habit's own daily deadline_time (local wall-clock, see
/// HabitDeadlineTimePicker.tsx / migration 0004) — purely a display nudge, distinct from
/// useCountdownToMidnight's on-chain-accurate UTC day boundary. `passed` flips to true once the
/// time's gone, for the caller to swap "Upload Proof" for a "Missed" state — this never affects
/// the real on-chain penalty, which still only fires at actual UTC-midnight settlement (see the
/// "UI-only, not real enforcement" decision this was built under).
export function useCountdownToDeadline(deadlineTime: string | null): DeadlineCountdown {
  const [state, setState] = useState(() => computeCountdown(deadlineTime));

  useEffect(() => {
    if (!deadlineTime) return;
    const id = setInterval(() => setState(computeCountdown(deadlineTime)), 1000);
    return () => clearInterval(id);
  }, [deadlineTime]);

  return state;
}
