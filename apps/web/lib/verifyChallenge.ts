import "server-only";
import { SignJWT, jwtVerify } from "jose";

const CHALLENGE_TTL_SECONDS = 5 * 60;

// Tiny physical gestures, not text — no OCR needed, checked by the same Gemini Vision call
// already looking at the habit photo. Kept easy/instant to do (no props, no writing anything).
const CHALLENGES = [
  "Hold up two fingers",
  "Give a thumbs up",
  "Make a peace sign",
  "Cover one eye with your hand",
  "Hold up three fingers",
  "Give a thumbs down",
  "Make a fist",
  "Touch your nose",
];

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(value);
}

export function pickChallenge(): string {
  return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
}

/// Reuses SESSION_SECRET (same as lib/session.ts) rather than a new env var — this is a
/// short-lived, narrowly-scoped token, not a session, but there's no reason to provision a
/// second secret for it.
export async function signChallengeToken(params: {
  wallet: string;
  contractIndex: number;
  challenge: string;
}): Promise<string> {
  return await new SignJWT({
    wallet: params.wallet.toLowerCase(),
    contractIndex: params.contractIndex,
    challenge: params.challenge,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(secret());
}

export interface VerifiedChallenge {
  wallet: string;
  contractIndex: number;
  challenge: string;
}

/// Verifies the token's signature, expiry, and that it was actually issued for this
/// wallet+habit — the challenge text itself always comes from the token, never trusted from a
/// separately-echoed client value, so a client can't claim whatever challenge suits a
/// pre-made image (see the plan's "trust boundary" note).
export async function verifyChallengeToken(
  token: string,
  expected: { wallet: string; contractIndex: number },
): Promise<VerifiedChallenge | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (
      typeof payload.wallet !== "string" ||
      typeof payload.contractIndex !== "number" ||
      typeof payload.challenge !== "string"
    ) {
      return null;
    }
    if (payload.wallet !== expected.wallet.toLowerCase() || payload.contractIndex !== expected.contractIndex) {
      return null;
    }
    return { wallet: payload.wallet, contractIndex: payload.contractIndex, challenge: payload.challenge };
  } catch {
    return null;
  }
}
