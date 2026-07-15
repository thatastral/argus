import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { publicClient } from "@/lib/chain";
import { createSession } from "@/lib/session";

const bodySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.string().uuid(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

/// Step 2 of wallet-signature login. Reconstructs the exact message from the stored nonce
/// row (never trusts a client-supplied message) and verifies the signature against it —
/// this covers both EOAs and ERC-1271 smart-contract wallets via viem's verifyMessage.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const address = parsed.data.address.toLowerCase();
  const supabase = supabaseAdmin();

  const { data: nonceRow, error: nonceError } = await supabase
    .from("auth_nonces")
    .select("wallet_address, expires_at, consumed_at")
    .eq("nonce", parsed.data.nonce)
    .single();

  if (nonceError || !nonceRow) {
    return NextResponse.json({ error: "Unknown nonce" }, { status: 400 });
  }
  if (nonceRow.wallet_address !== address) {
    return NextResponse.json({ error: "Address mismatch" }, { status: 400 });
  }
  if (nonceRow.consumed_at) {
    return NextResponse.json({ error: "Nonce already used" }, { status: 400 });
  }
  if (new Date(nonceRow.expires_at) < new Date()) {
    return NextResponse.json({ error: "Nonce expired" }, { status: 400 });
  }

  // Postgres/PostgREST returns timestamptz as "...+00:00", but the nonce route built the
  // originally-signed message using JS's Date#toISOString() ("...Z") — reconstructing with
  // the raw DB string would produce different bytes than what the wallet actually signed.
  // Route both through toISOString() so they match.
  const message =
    `Sign in to Argus.\n\n` +
    `Wallet: ${address}\n` +
    `Nonce: ${parsed.data.nonce}\n` +
    `Expires: ${new Date(nonceRow.expires_at).toISOString()}`;

  const isValid = await publicClient.verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: parsed.data.signature as `0x${string}`,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  await supabase.from("auth_nonces").update({ consumed_at: new Date().toISOString() }).eq("nonce", parsed.data.nonce);

  const { data: existingUser } = await supabase
    .from("users")
    .select("wallet_address")
    .eq("wallet_address", address)
    .maybeSingle();

  const isNewUser = !existingUser;

  if (isNewUser) {
    const { error: insertError } = await supabase.from("users").insert({
      wallet_address: address,
      display_name: `${address.slice(0, 6)}...${address.slice(-4)}`,
      wallet_mode: "easy",
    });
    // Every other table (habits, penalty_configs, ...) has a foreign key to users — issuing
    // a session for a user row that doesn't actually exist would let the client past this
    // point only to fail with an opaque FK violation on the next write. Fail loudly here
    // instead, where the cause is obvious.
    if (insertError) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
  }

  await createSession(address);

  return NextResponse.json({ address, isNewUser });
}
