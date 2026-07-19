import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { pickChallenge, signChallengeToken } from "@/lib/verifyChallenge";

const querySchema = z.object({
  // No upper bound — see the same note in app/api/habits/route.ts's bodySchema.
  contractIndex: z.coerce.number().int().min(0),
});

/// Called right before the client opens the live camera — the challenge shown on-screen and the
/// token sent back with the capture must be the same pair issued here (see verifyChallengeToken
/// in lib/verifyChallenge.ts for why this can't just be a client-supplied value).
export async function GET(request: Request) {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ contractIndex: searchParams.get("contractIndex") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const challenge = pickChallenge();
  const token = await signChallengeToken({ wallet, contractIndex: parsed.data.contractIndex, challenge });

  return NextResponse.json({ challenge, token });
}
