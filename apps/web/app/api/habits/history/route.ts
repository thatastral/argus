import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { publicClient, contractAddresses } from "@/lib/chain";
import { abis } from "@/lib/contracts";
import { isWithinHabitDuration } from "@/lib/habitDuration";

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
      .select(
        "contract_index, name, active, target_days, deadline_time, created_at, stake_amount_wei::text, stake_asset_symbol, stake_asset_decimals",
      )
      .eq("wallet_address", wallet)
      // Scoped to the currently-configured contract (migration 0008) — redeploying (routine on
      // this project) resets HabitManager to zero for everyone, so a row left over from a prior
      // deployment must never bleed into history as an "imaginary" day that never happened on
      // the current contract, or as a stale "today's habit" that doesn't correspond to anything
      // real. See app/api/habits/route.ts's POST handler for where this gets tagged.
      .eq("habit_manager_address", contractAddresses.habitManager ?? "")
      .order("contract_index", { ascending: true }),
    supabase.from("penalty_configs").select("penalty_type").eq("wallet_address", wallet).maybeSingle(),
  ]);

  const habitRows = habits ?? [];
  if (habitRows.length === 0) {
    return NextResponse.json({ days: [], penaltyType: null });
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
      // If this read fails, fall through with startDay=0 — the earliestHabitDayIndex floor
      // below is what actually keeps this safe (see its comment); without that floor, `full`
      // mode would otherwise walk the day loop all the way back to the Unix epoch.
    }
  }
  const todayDayIndex = Math.floor(Date.now() / 86_400_000);

  // Defensive floor for the startDay read failing above: no current-contract habit (habitRows is
  // already scoped by habit_manager_address) can predate its own created_at, so this is a hard
  // bound regardless of what startDay resolved to. Without it, a failed read defaulting to 0
  // combined with `full` mode would walk the day loop below back to the Unix epoch (tens of
  // thousands of iterations) instead of "a couple of extra days" as the on-chain read's own
  // catch below assumes.
  const earliestHabitDayIndex = Math.min(
    ...habitRows.map((h) => Math.floor(new Date(h.created_at).getTime() / 86_400_000)),
  );

  // Full mode (HistoryModal) goes all the way back to startDay; the home screen stays capped at
  // HOME_WINDOW_DAYS regardless of how long ago startDay was.
  const windowStart = full
    ? Math.max(startDay, earliestHabitDayIndex)
    : Math.max(startDay, earliestHabitDayIndex, todayDayIndex - (HOME_WINDOW_DAYS - 1));
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
    // A habit belongs on a day if it existed by then (created on or before that day) and, if it
    // was only configured to recur for a fixed number of days (targetDays, isWithinHabitDuration
    // above), that day still falls within that span — a 1-day habit must not keep reappearing on
    // every later day just because it once existed, which is what "don't automatically repeat
    // yesterday's habits unless configured to recur for multiple days" actually means for history.
    // This is what makes a past day's "Missed" status stick even after the habit is later
    // deactivated. Today is the one exception: it also requires the habit to still be active,
    // since a habit deactivated today has nothing left to upload proof for and shouldn't show as
    // actionable.
    const habitsForDay = habitRows.filter((h) => {
      const createdDayIndex = Math.floor(new Date(h.created_at).getTime() / 86_400_000);
      if (createdDayIndex > dayIndex) return false;
      if (!isWithinHabitDuration(h.created_at, h.target_days, dayIndex)) return false;
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
        // Per-habit now (migration 0007) — each habit locked in its own stake at creation and it
        // never changes, so this repeats the same value on every day row for a given habit
        // (a habit-level fact, not a per-day one), same pattern targetDays already uses.
        stakeAmountWei: h.stake_amount_wei,
        stakeAssetSymbol: h.stake_asset_symbol,
        stakeAssetDecimals: h.stake_asset_decimals,
      })),
    };
  });

  return NextResponse.json({
    days,
    penaltyType: penalty?.penalty_type ?? null,
  });
}
