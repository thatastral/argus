import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin, ensureUser } from "@/lib/supabase/server";

const bodySchema = z.object({
  penaltyType: z.enum(["savingsVault", "donate"]),
  // Which asset the wallet will hold — still meaningful and still set here (during the
  // onboarding penalty step, before a vault exists to ask directly — see CLAUDE.md/migration
  // 0002), even though the *amount* it used to also carry moved to HabitManager.habitStake
  // (locked in per-habit at creation, see useCreateHabit.ts). Omitted by useSetPenaltyType.ts's
  // later "just change the consequence type" calls, which leaves whatever was set here alone.
  assetSymbol: z.string().min(1).max(16).optional(),
  assetDecimals: z.number().int().min(0).max(18).optional(),
});

/// Called right after the client's own PenaltyEngine.configurePenalty() tx confirms.
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

  const payload: Record<string, unknown> = {
    wallet_address: wallet,
    penalty_type: parsed.data.penaltyType,
  };
  if (parsed.data.assetSymbol !== undefined) payload.asset_symbol = parsed.data.assetSymbol;
  if (parsed.data.assetDecimals !== undefined) payload.asset_decimals = parsed.data.assetDecimals;

  const { error } = await supabase.from("penalty_configs").upsert(payload);

  if (error) {
    return NextResponse.json({ error: "Failed to save penalty config" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
