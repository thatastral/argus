import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ wallet: null });
  }

  const supabase = supabaseAdmin();
  const { data: user } = await supabase
    .from("users")
    .select("display_name, wallet_mode, accountability_wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle();

  return NextResponse.json({ wallet, user });
}
