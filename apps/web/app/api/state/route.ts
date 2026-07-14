import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";

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

  const supabase = supabaseAdmin();
  const [{ data: user }, { data: habits }, { data: streak }, { data: penalty }, { data: todaysCompletions }] =
    await Promise.all([
      supabase
        .from("users")
        .select("display_name, wallet_mode, accountability_wallet_address")
        .eq("wallet_address", wallet)
        .maybeSingle(),
      supabase
        .from("habits")
        .select("contract_index, name, active")
        .eq("wallet_address", wallet)
        .order("contract_index", { ascending: true }),
      supabase.from("streak_cache").select("*").eq("wallet_address", wallet).maybeSingle(),
      supabase.from("penalty_configs").select("*").eq("wallet_address", wallet).maybeSingle(),
      supabase
        .from("habit_completions")
        .select("contract_index, verified, confidence")
        .eq("wallet_address", wallet)
        .eq("day", today()),
    ]);

  return NextResponse.json({
    wallet,
    user,
    habits: habits ?? [],
    streak,
    penalty,
    todaysCompletions: todaysCompletions ?? [],
  });
}
