import "server-only";
import { createClient } from "@supabase/supabase-js";

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
