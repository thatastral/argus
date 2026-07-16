import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin, ensureUser } from "@/lib/supabase/server";

const bodySchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  accountabilityWalletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

/// Mirrors setup-flow choices that don't belong on-chain (display name) plus the
/// AccountabilityWallet address once the client has deployed it via ArgusFactory.
export async function POST(request: Request) {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, string> = {};
  if (parsed.data.displayName) update.display_name = parsed.data.displayName;
  if (parsed.data.accountabilityWalletAddress) {
    update.accountability_wallet_address = parsed.data.accountabilityWalletAddress.toLowerCase();
  }

  const supabase = supabaseAdmin();
  if (!(await ensureUser(supabase, wallet))) {
    return NextResponse.json({ error: "Failed to ensure user record" }, { status: 500 });
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("users").update(update).eq("wallet_address", wallet);
    if (error) {
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
