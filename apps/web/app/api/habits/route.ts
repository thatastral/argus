import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin, ensureUser } from "@/lib/supabase/server";
import { contractAddresses } from "@/lib/chain";

const bodySchema = z.object({
  // No upper bound — MAX_HABITS (3) gates *active* habits on-chain, not the lifetime index.
  // habitCountOf only ever grows and a deactivated index is never reused (see CLAUDE.md's
  // 3-habit-cap gotcha), so a wallet that has created/deleted a handful of habits over time will
  // legitimately reach index 3, 4, 5... — capping this at 2 made every one of those permanently
  // unmirrorable (confirmed live: a stuck, non-dismissible "Existing habits found" recovery modal
  // that could never actually save, since the on-chain habit's real index was already past 2).
  contractIndex: z.number().int().min(0),
  name: z.string().min(1).max(64),
  // Off-chain-only, informational (see CLAUDE.md/migration 0002) — omit entirely to leave an
  // existing value untouched (used by the rename path, useRenameHabit.ts), pass null for "no
  // end date", or a positive day count.
  targetDays: z.number().int().positive().nullable().optional(),
  // Off-chain-only, informational (migration 0004) — "HH:MM" 24-hour, same omit/null semantics
  // as targetDays above.
  deadlineTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  // True only from a genuine first-mirror-write for this contractIndex — the fresh-create path
  // (useCreateHabit.ts) and the two orphan-recovery paths (RecoverHabitsModal.tsx,
  // SetupFlow.tsx's inline recovery step), never the rename path (useRenameHabit.ts). See the
  // stale-completions cleanup below for why this matters.
  isNewHabit: z.boolean().optional(),
  // Off-chain-only mirror of HabitManager.habitStake (migration 0007) — locked in once, only
  // ever sent alongside isNewHabit:true (a genuine creation), never on a rename. On-chain stays
  // the source of truth; this is purely so the UI can show a habit's own stake without a
  // separate on-chain read per row.
  stakeAmountWei: z
    .string()
    .regex(/^[0-9]+$/)
    .optional(),
  assetSymbol: z.string().min(1).max(16).optional(),
  assetDecimals: z.number().int().min(0).max(18).optional(),
});

/// Called right after the client's own HabitManager.createHabit() tx confirms, so the
/// off-chain mirror's contract_index always matches the on-chain array index. Also reused
/// as-is for renaming (same upsert, same contractIndex, new name) — see useRenameHabit.ts.
export async function POST(request: Request) {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!(await ensureUser(supabase, wallet))) {
    return NextResponse.json({ error: "Failed to ensure user record" }, { status: 500 });
  }

  if (parsed.data.isNewHabit) {
    // A genuinely new on-chain index can't have legitimate completion history — within one
    // contract deployment, HabitManager never reuses a deactivated index (see CLAUDE.md's
    // 3-habit-cap gotcha), so any habit_completions row already sitting at this
    // (wallet_address, contract_index) predates this habit's real identity. Confirmed-plausible
    // live cause: a Monad testnet redeploy resets habitCount to 0, so a brand-new habit can land
    // on an index that still has a prior deployment's completion row for today, making it read
    // as instantly "Completed" with no proof ever submitted. Purge before the upsert below,
    // across all days (not just today) — a stale past-day row would equally corrupt the new
    // habit's history view.
    const { error: cleanupError } = await supabase
      .from("habit_completions")
      .delete()
      .eq("wallet_address", wallet)
      .eq("contract_index", parsed.data.contractIndex);
    if (cleanupError) {
      return NextResponse.json({ error: "Failed to prepare habit slot" }, { status: 500 });
    }
  }

  const payload: Record<string, unknown> = {
    wallet_address: wallet,
    contract_index: parsed.data.contractIndex,
    name: parsed.data.name,
    active: true,
    // Tags this row with whichever contract is currently configured (migration 0008) — every
    // read filters on this, so redeploying (routine on this project) can never make a stale row
    // from a prior deployment bleed back in as "today's habit" or an "imaginary" history day.
    // Always set, not conditional — a rename (useRenameHabit.ts) reusing this same upsert should
    // also re-stamp the row as current if it's somehow stale, rather than leaving an old tag.
    habit_manager_address: contractAddresses.habitManager ?? null,
  };
  if (parsed.data.targetDays !== undefined) {
    payload.target_days = parsed.data.targetDays;
  }
  if (parsed.data.deadlineTime !== undefined) {
    payload.deadline_time = parsed.data.deadlineTime;
  }
  if (parsed.data.stakeAmountWei !== undefined) {
    payload.stake_amount_wei = parsed.data.stakeAmountWei;
  }
  if (parsed.data.assetSymbol !== undefined) {
    payload.stake_asset_symbol = parsed.data.assetSymbol;
  }
  if (parsed.data.assetDecimals !== undefined) {
    payload.stake_asset_decimals = parsed.data.assetDecimals;
  }

  const { error } = await supabase.from("habits").upsert(payload, { onConflict: "wallet_address,contract_index" });

  if (error) {
    return NextResponse.json({ error: "Failed to save habit" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("habits")
    .select(
      "contract_index, name, active, target_days, deadline_time, created_at, stake_amount_wei::text, stake_asset_symbol, stake_asset_decimals",
    )
    .eq("wallet_address", wallet)
    // Scoped to the currently-configured contract (migration 0008) — see the POST handler's
    // comment for why. A row left over from a prior deployment has a different (or null)
    // habit_manager_address and is correctly excluded here rather than showing as a real habit.
    .eq("habit_manager_address", contractAddresses.habitManager ?? "")
    .order("contract_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load habits" }, { status: 500 });
  }

  return NextResponse.json({ habits: data });
}

const patchSchema = z.object({
  // See the same no-upper-bound note on bodySchema above.
  contractIndex: z.number().int().min(0),
});

/// Mirrors HabitManager.setHabitActive(index, false) after the on-chain tx confirms — see
/// hooks/useDeleteHabit.ts. A plain update (not upsert) so this can never touch `name`, unlike
/// the POST handler above which intentionally always sets active:true.
export async function PATCH(request: Request) {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("habits")
    .update({ active: false })
    .eq("wallet_address", wallet)
    .eq("contract_index", parsed.data.contractIndex)
    // Defensive — the contractIndex driving this call always comes from a live, current-contract
    // read already (useUnmirroredHabits.ts / dashboard state), so this should never actually
    // exclude anything; it just guarantees a deactivate can never touch a stale prior-deployment
    // row that happens to share the same wallet+index.
    .eq("habit_manager_address", contractAddresses.habitManager ?? "");

  if (error) {
    return NextResponse.json({ error: "Failed to remove habit" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
