import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin, ensureUser } from "@/lib/supabase/server";

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
  };
  if (parsed.data.targetDays !== undefined) {
    payload.target_days = parsed.data.targetDays;
  }
  if (parsed.data.deadlineTime !== undefined) {
    payload.deadline_time = parsed.data.deadlineTime;
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
    .select("contract_index, name, active, target_days, deadline_time, created_at")
    .eq("wallet_address", wallet)
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
    .eq("contract_index", parsed.data.contractIndex);

  if (error) {
    return NextResponse.json({ error: "Failed to remove habit" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
