import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";

const bodySchema = z.object({
  contractIndex: z.number().int().min(0).max(2),
  name: z.string().min(1).max(64),
});

/// Called right after the client's own HabitManager.createHabit() tx confirms, so the
/// off-chain mirror's contract_index always matches the on-chain array index.
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
  const { error } = await supabase.from("habits").upsert(
    {
      wallet_address: wallet,
      contract_index: parsed.data.contractIndex,
      name: parsed.data.name,
      active: true,
    },
    { onConflict: "wallet_address,contract_index" },
  );

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
    .select("contract_index, name, active")
    .eq("wallet_address", wallet)
    .order("contract_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load habits" }, { status: 500 });
  }

  return NextResponse.json({ habits: data });
}
