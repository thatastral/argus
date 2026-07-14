import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { progressCoachReply } from "@/lib/gemini";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
});

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

  const [{ data: user }, { data: habits }, { data: streak }, { data: penalty }, { data: recentSettlements }] =
    await Promise.all([
      supabase.from("users").select("display_name, wallet_mode, accountability_wallet_address").eq(
        "wallet_address",
        wallet,
      ).maybeSingle(),
      supabase.from("habits").select("contract_index, name, active").eq("wallet_address", wallet),
      supabase.from("streak_cache").select("*").eq("wallet_address", wallet).maybeSingle(),
      supabase.from("penalty_configs").select("penalty_type, amount_wei").eq("wallet_address", wallet).maybeSingle(),
      supabase
        .from("daily_settlements")
        .select("day, success, resolved_penalty_type")
        .eq("wallet_address", wallet)
        .order("day", { ascending: false })
        .limit(14),
    ]);

  const contextJson = JSON.stringify({
    displayName: user?.display_name ?? null,
    walletMode: user?.wallet_mode ?? null,
    habits: habits ?? [],
    streak: streak ?? { current_streak: 0, longest_streak: 0, completion_rate_bps: 0 },
    penalty: penalty ?? null,
    recentSettlements: recentSettlements ?? [],
  });

  const reply = await progressCoachReply({ userMessage: parsed.data.message, contextJson });

  await supabase.from("chat_messages").insert([
    { wallet_address: wallet, role: "user", content: parsed.data.message },
    { wallet_address: wallet, role: "assistant", content: reply },
  ]);

  return NextResponse.json({ reply });
}
