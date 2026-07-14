import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";

const bodySchema = z.object({
  penaltyType: z.enum(["save", "donate", "partner", "surprise"]),
  partnerAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  amountWei: z.string().regex(/^[0-9]+$/),
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
  const { error } = await supabase.from("penalty_configs").upsert({
    wallet_address: wallet,
    penalty_type: parsed.data.penaltyType,
    partner_address: parsed.data.partnerAddress?.toLowerCase() ?? null,
    amount_wei: parsed.data.amountWei,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to save penalty config" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
