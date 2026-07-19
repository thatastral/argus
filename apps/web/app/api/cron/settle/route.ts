import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { settlePendingDays, contractAddresses } from "@/lib/chain";

// Sequential across users, so a large-ish backlog stays within one invocation. Fine at
// hackathon/MVP scale (a handful of test wallets); if the user base grows enough that this
// starts timing out, batch with Promise.all in small groups instead of going fully parallel
// (parallel settle() calls for different users still compete for the same verifier nonce).
export const maxDuration = 300;

/// The real daily settlement cron (see CLAUDE.md's former "no real cron" known gap) — replaces
/// pure opportunistic settlement (previously only /api/state and /api/verify, which only ever
/// ran if a user happened to open the app or verify a habit around a day boundary). Registered
/// in vercel.json to run once daily shortly after UTC midnight, so a missed day's penalty (and
/// the resulting streak update) fires even if nobody touches the app that day.
///
/// Protected by CRON_SECRET rather than a user session — this has no wallet of its own, it acts
/// on every wallet with at least one active habit. Vercel's own cron invocations send
/// `Authorization: Bearer $CRON_SECRET` automatically when the env var is set; verify it matches
/// so nobody else can trigger a settlement sweep.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  // Scoped to the currently-configured contract (migration 0008) — otherwise a redeploy (routine
  // on this project) leaves this sweep still targeting wallets whose habits only exist on a now-
  // defunct HabitManager, where settle() always reverts with NoHabitsYet on the very first try;
  // harmless (swallowed by settlePendingDays' catch) but wastes every cron tick chasing wallets
  // that can never have anything to settle on the current contract.
  const { data: rows, error } = await supabase
    .from("habits")
    .select("wallet_address")
    .eq("active", true)
    .eq("habit_manager_address", contractAddresses.habitManager ?? "");
  if (error) {
    return NextResponse.json({ error: "Failed to load wallets" }, { status: 500 });
  }

  const wallets = [...new Set((rows ?? []).map((r) => r.wallet_address))];

  let totalSettled = 0;
  const failures: string[] = [];
  for (const wallet of wallets) {
    try {
      totalSettled += await settlePendingDays(wallet as `0x${string}`);
    } catch {
      failures.push(wallet);
    }
  }

  return NextResponse.json({ walletsProcessed: wallets.length, daysSettled: totalSettled, failures });
}
