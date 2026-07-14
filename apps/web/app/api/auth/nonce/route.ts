import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete the signature

const bodySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

/// Step 1 of wallet-signature login: mint a single-use nonce and the exact message the
/// wallet must sign. The client calls this, signs the returned `message` with the wallet,
/// then POSTs the signature to /api/auth/verify.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const address = parsed.data.address.toLowerCase();
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("auth_nonces").insert({
    wallet_address: address,
    nonce,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: "Failed to create nonce" }, { status: 500 });
  }

  const message =
    `Sign in to Argus.\n\n` +
    `Wallet: ${address}\n` +
    `Nonce: ${nonce}\n` +
    `Expires: ${expiresAt.toISOString()}`;

  return NextResponse.json({ nonce, message });
}
