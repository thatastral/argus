import { NextResponse, after } from "next/server";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { relayPendingCompletions, settlePendingDays, contractAddresses } from "@/lib/chain";
import { isWithinHabitDuration } from "@/lib/habitDuration";

function today() {
  return new Date().toISOString().slice(0, 10);
}

/// One-call dashboard bootstrap: everything the UI needs on load, from the off-chain
/// mirror tables. On-chain reads (live balance, live unlock state) happen client-side
/// via wagmi so they're never stale by the time the user acts on them.
export async function GET() {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Best-effort streak catch-up on every dashboard load — see lib/chain.ts. Scheduled via
  // after() rather than awaited: a backlog of unsettled days each needs a real on-chain write +
  // confirmation (confirmed live — an 11s response time for one such backlog on this test
  // wallet), far too slow to block the dashboard on. Runs after the response is sent;
  // useStreak's polling (hooks/useStreak.ts) picks up the result on a later refetch.
  after(async () => {
    try {
      // Relay first — a today's-verified-but-unrelayed completion (see relayPendingCompletions'
      // doc comment) needs to land on-chain before it can ever count toward settle(), and only
      // ever has a chance to while it's still today.
      await relayPendingCompletions(wallet as `0x${string}`);
      await settlePendingDays(wallet as `0x${string}`);
    } catch {
      // ignore — this is just opportunistic catch-up
    }
  });

  const supabase = supabaseAdmin();
  const [{ data: user }, { data: habits }, { data: streak }, { data: penalty }, { data: todaysCompletions }, { data: recentVerified }] =
    await Promise.all([
      supabase
        .from("users")
        .select("display_name, accountability_wallet_address")
        .eq("wallet_address", wallet)
        .maybeSingle(),
      // deadline_time lets the dashboard's welcome-line summary resolve "today" the same way
      // HabitDayGroups.tsx does (verified, or its own deadline has passed) instead of only ever
      // looking at `verified` — see app/page.tsx. target_days/created_at (below) are only used
      // here to fold duration-elapsed habits out of `active` before returning — not otherwise
      // exposed, so page.tsx's existing `.filter((h) => h.active)` keeps working unmodified.
      supabase
        .from("habits")
        .select("contract_index, name, active, deadline_time, target_days, created_at")
        .eq("wallet_address", wallet)
        // Scoped to the currently-configured contract (migration 0008) — see
        // app/api/habits/route.ts's POST handler for why a redeploy must never let a prior
        // deployment's row surface as "today's habit" on the dashboard.
        .eq("habit_manager_address", contractAddresses.habitManager ?? "")
        .order("contract_index", { ascending: true }),
      supabase.from("streak_cache").select("*").eq("wallet_address", wallet).maybeSingle(),
      // amount_wei is numeric(78,0) — cast to text so PostgREST sends it as a JSON string.
      // As a bare JSON number it round-trips through JSON.parse as a JS `number` (IEEE 754
      // double), which loses precision above 2^53 (~9e15) — well within range for wei amounts
      // (confirmed: a generic large integer does NOT survive JSON.parse exactly, only some
      // values happen to by coincidence). SettingsSheet does BigInt(amount_wei) on this value.
      supabase
        .from("penalty_configs")
        .select("wallet_address, penalty_type, amount_wei::text, asset_symbol, asset_decimals, updated_at")
        .eq("wallet_address", wallet)
        .maybeSingle(),
      supabase
        .from("habit_completions")
        .select("contract_index, verified, confidence")
        .eq("wallet_address", wallet)
        .eq("day", today()),
      // Raw timestamps only — lib/insight.ts's computeInsight() runs client-side (app/page.tsx)
      // so "usual completion hour" reflects the user's own local timezone, not this server's.
      supabase
        .from("habit_completions")
        .select("created_at")
        .eq("wallet_address", wallet)
        .eq("verified", true)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const todayDayIndex = Math.floor(Date.now() / 86_400_000);
  // Folds "was this habit only configured to recur for a fixed number of days, and has that span
  // now elapsed" into `active` itself, so every existing consumer of this response (page.tsx's
  // `.filter((h) => h.active)` for the dashboard's action list) automatically stops treating a
  // finished fixed-duration habit as "today's habit" without needing its own duration-aware
  // logic. The underlying habits.active column (mirrors on-chain/manual deactivation) is
  // untouched — this only affects what this one response reports.
  const habitsWithEffectiveActive = (habits ?? []).map((h) => ({
    ...h,
    active: h.active && isWithinHabitDuration(h.created_at, h.target_days, todayDayIndex),
  }));

  return NextResponse.json({
    wallet,
    user,
    habits: habitsWithEffectiveActive,
    streak,
    penalty,
    todaysCompletions: todaysCompletions ?? [],
    recentCompletionTimestamps: (recentVerified ?? []).map((r) => r.created_at),
  });
}
