import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { publicClient, contractAddresses } from "@/lib/chain";
import { abis } from "@/lib/contracts";

// Home screen only ever shows the last 4 days (today + 3) per the "history belongs in its own
// view" redesign — a longer/unbounded range is available via `?window=full` (HistoryModal.tsx),
// which ignores this cap and goes back to the habit's on-chain startDay instead.
const HOME_WINDOW_DAYS = 4;

function utcDateString(daysAgo: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/// Day-grouped habit completion history for the "Habits" section of the home screen (per the
/// Figma spec: "Today" with a live countdown, then past days each showing every active habit's
/// per-day status). Kept separate from /api/state (which just gates setup-vs-dashboard and
/// doesn't need this extra query cost on every load).
export async function GET(request: Request) {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const full = new URL(request.url).searchParams.get("window") === "full";
  const supabase = supabaseAdmin();

  // Not `.eq("active", true)` — a habit deactivated after being missed must still show as
  // missed on the days it existed. Filtering to only-currently-active here was the bug behind
  // past days silently rendering as "Completed" once their one missed habit was deleted; see
  // the per-day existence check below instead.
  const [{ data: habits }, { data: penalty }] = await Promise.all([
    supabase
      .from("habits")
      .select("contract_index, name, active, target_days, deadline_time, created_at")
      .eq("wallet_address", wallet)
      .order("contract_index", { ascending: true }),
    supabase
      .from("penalty_configs")
      .select("penalty_type, amount_wei::text")
      .eq("wallet_address", wallet)
      .maybeSingle(),
  ]);

  const habitRows = habits ?? [];
  if (habitRows.length === 0) {
    return NextResponse.json({ days: [], stakeAmountWei: null, penaltyType: null });
  }

  // Don't show history from before the user's first habit — startDay is on-chain (HabitManager
  // tracks it precisely; Supabase's habits.created_at is a reasonable proxy but this is the
  // authoritative source), read directly rather than guessing from the mirror table.
  let startDay = 0;
  if (contractAddresses.habitManager) {
    try {
      const raw = (await publicClient.readContract({
        address: contractAddresses.habitManager,
        abi: abis.habitManager,
        functionName: "startDay",
        args: [wallet as `0x${string}`],
      })) as bigint;
      startDay = Number(raw);
    } catch {
      // If this read fails, fall through with startDay=0 — worst case we show a couple of
      // extra pre-account days that will just render as "no habits were active" naturally
      // once we intersect with actual completion rows below.
    }
  }
  const todayDayIndex = Math.floor(Date.now() / 86_400_000);

  // Full mode (HistoryModal) goes all the way back to startDay; the home screen stays capped at
  // HOME_WINDOW_DAYS regardless of how long ago startDay was.
  const windowStart = full ? startDay : Math.max(startDay, todayDayIndex - (HOME_WINDOW_DAYS - 1));
  const dayEntries: { day: string; dayIndex: number }[] = [];
  for (let d = todayDayIndex; d >= windowStart; d--) {
    dayEntries.push({ day: utcDateString(todayDayIndex - d), dayIndex: d });
  }
  const dayStrings = dayEntries.map((e) => e.day);

  const { data: completions } = await supabase
    .from("habit_completions")
    .select("contract_index, day, verified")
    .eq("wallet_address", wallet)
    .in("day", dayStrings);

  const completionMap = new Map<string, boolean>();
  for (const c of completions ?? []) {
    completionMap.set(`${c.day}:${c.contract_index}`, c.verified);
  }

  // Off-chain-only commitment tracking (migration 0002) — purely informational, doesn't affect
  // completion/streak logic. Same value repeats on every day row for a given habit, matching the
  // existing stakeLabel pattern (a habit-level fact, not a per-day one).
  function daysRemaining(createdAt: string, targetDays: number | null): number | null {
    if (targetDays === null) return null;
    const createdDayIndex = Math.floor(new Date(createdAt).getTime() / 86_400_000);
    return Math.max(targetDays - (todayDayIndex - createdDayIndex), 0);
  }

  const today = utcDateString(0);
  const days = dayEntries.map(({ day, dayIndex }) => {
    const isToday = day === today;
    // A habit belongs on a day if it existed by then (created on or before that day) — this is
    // what makes a past day's "Missed" status stick even after the habit is later deactivated.
    // Today is the one exception: it also requires the habit to still be active, since a habit
    // deactivated today has nothing left to upload proof for and shouldn't show as actionable.
    const habitsForDay = habitRows.filter((h) => {
      const createdDayIndex = Math.floor(new Date(h.created_at).getTime() / 86_400_000);
      if (createdDayIndex > dayIndex) return false;
      return isToday ? h.active : true;
    });

    return {
      day,
      isToday,
      habits: habitsForDay.map((h) => ({
        contractIndex: h.contract_index,
        name: h.name,
        verified: completionMap.get(`${day}:${h.contract_index}`) ?? false,
        targetDays: h.target_days,
        daysRemaining: daysRemaining(h.created_at, h.target_days),
        // Postgres returns `time` as "HH:MM:SS" — trim to "HH:MM" to match what the picker writes.
        deadlineTime: h.deadline_time ? h.deadline_time.slice(0, 5) : null,
      })),
    };
  });

  return NextResponse.json({
    days,
    stakeAmountWei: penalty?.amount_wei ?? null,
    penaltyType: penalty?.penalty_type ?? null,
  });
}
