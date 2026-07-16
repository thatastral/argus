import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/// Service-role client used by every API route. RLS is enabled with no policies on every
/// table (see packages/supabase/migrations/0001_init.sql), so only this key can read/write —
/// never expose it to the browser.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/// habits/penalty_configs/etc all have a foreign key to users(wallet_address). A valid
/// session should always imply a users row exists (auth/verify creates one at sign-in and
/// fails the sign-in itself if that insert fails) — but the row can still go missing later
/// (manually deleted in the Supabase dashboard, a wiped table during testing, etc.), and
/// when it does, every FK-dependent write fails with an opaque 23503 with no indication why.
/// Call this before any such write so a missing row self-heals instead of hard-failing.
/// ignoreDuplicates means an existing row (and its display_name) is left alone.
export async function ensureUser(supabase: SupabaseClient, wallet: string): Promise<boolean> {
  const { error } = await supabase.from("users").upsert(
    {
      wallet_address: wallet,
      display_name: `${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
    },
    { onConflict: "wallet_address", ignoreDuplicates: true },
  );
  return !error;
}
