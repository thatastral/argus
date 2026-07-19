import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyHabitProof } from "@/lib/gemini";
import {
  getVerifierWalletClient,
  publicClient,
  contractAddresses,
  relayPendingCompletions,
  settlePendingDays,
} from "@/lib/chain";
import { abis } from "@/lib/contracts";
import { computeImageHash, hammingDistance, DUPLICATE_HASH_THRESHOLD } from "@/lib/proofForensics";
import { verifyChallengeToken } from "@/lib/verifyChallenge";

const CONFIDENCE_THRESHOLD = 0.8;

const bodySchema = z.object({
  // No upper bound — see the same note in app/api/habits/route.ts's bodySchema.
  contractIndex: z.number().int().min(0),
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
  // Issued by GET /api/verify/challenge right before capture — proves which random gesture was
  // actually shown to this wallet for this habit, so the challenge check below can't be spoofed
  // by a client just claiming whatever value suits a pre-made image.
  challengeToken: z.string().min(1),
  // Only true when LiveCameraCapture hit getUserMedia's NotFoundError (no camera device at
  // all) and fell back to a file picker — never set for a declined permission. Pure audit trail
  // for now; the challenge-gesture check below still applies either way (unlike proofType
  // "appSummary", this is still a photo of the user, just not captured live).
  viaGalleryFallback: z.boolean().optional(),
  // "camera" (default) is a live capture, gesture-challenge required. "appSummary" is an
  // explicit second submission path (see components/LiveCameraCapture.tsx) for a screenshot of
  // an app-generated summary (Strava, WakaTime, Kindle, etc.) — no gesture to check there, so
  // the challenge requirement is skipped for it below; the token itself is still verified either
  // way, for request-authenticity, not the gesture.
  proofType: z.enum(["camera", "appSummary"]).default("camera"),
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

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
  const { contractIndex, imageBase64, mimeType, challengeToken, viaGalleryFallback, proofType } = parsed.data;

  const verifiedChallenge = await verifyChallengeToken(challengeToken, { wallet, contractIndex });
  if (!verifiedChallenge) {
    return NextResponse.json(
      { error: "Your capture session expired — go back and try again." },
      { status: 400 },
    );
  }

  const { data: habit } = await supabase
    .from("habits")
    .select("name, active")
    .eq("wallet_address", wallet)
    .eq("contract_index", contractIndex)
    .maybeSingle();

  if (!habit || !habit.active) {
    return NextResponse.json({ error: "Habit not found" }, { status: 404 });
  }

  const day = today();
  const imagePath = `${wallet}/${day}/${contractIndex}.jpg`;
  const imageBytes = Buffer.from(imageBase64, "base64");

  const { error: uploadError } = await supabase.storage.from("proofs").upload(imagePath, imageBytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (uploadError) {
    return NextResponse.json({ error: "Failed to store proof image" }, { status: 500 });
  }

  let imageHash: string | null = null;
  try {
    imageHash = await computeImageHash(imageBytes);
  } catch (err) {
    console.error("computeImageHash failed", err);
  }

  // Perceptual-hash duplicate check — deterministic, cheap, and not promptable-around, so it
  // runs before spending a Gemini call. Scanned across every user's submissions, not just this
  // wallet's own (catches a shared "this passes" image circulating, not just self-reuse).
  if (imageHash) {
    const { data: priorHashes } = await supabase
      .from("habit_completions")
      .select("image_hash")
      .not("image_hash", "is", null);

    const duplicateHash = imageHash;
    const isDuplicate = (priorHashes ?? []).some(
      (row) => row.image_hash && hammingDistance(row.image_hash, duplicateHash) <= DUPLICATE_HASH_THRESHOLD,
    );

    if (isDuplicate) {
      const result = {
        verified: false,
        confidence: 0,
        reason:
          "This photo — or one very similar — has already been used for a previous submission. Please submit a fresh photo.",
      };

      await supabase.from("habit_completions").upsert(
        {
          wallet_address: wallet,
          contract_index: contractIndex,
          day,
          image_path: imagePath,
          verified: false,
          confidence: 0,
          reason: result.reason,
          onchain_tx_hash: null,
          image_hash: imageHash,
          via_gallery_fallback: viaGalleryFallback ?? false,
          proof_type: proofType,
        },
        { onConflict: "wallet_address,contract_index,day" },
      );

      return NextResponse.json({ ...result, onchainTxHash: null });
    }
  }

  let aiResult: Awaited<ReturnType<typeof verifyHabitProof>>;
  try {
    aiResult = await verifyHabitProof({
      habitName: habit.name,
      imageBase64,
      mimeType,
      challenge: verifiedChallenge.challenge,
      proofType,
    });
  } catch (err) {
    // The image is already uploaded — don't leave it orphaned with no record. Write a
    // not-verified completion row explaining why, so the UI has something coherent to show
    // instead of a bare request failure, and the user knows to retry rather than assume
    // their proof was silently ignored.
    console.error("verifyHabitProof failed", err);
    aiResult = {
      verified: false,
      challengePassed: false,
      confidence: 0,
      reason:
        err instanceof Error && err.message.includes("GEMINI_API_KEY")
          ? "AI verification isn't configured yet — ask whoever runs this app to set GEMINI_API_KEY."
          : "Verification service is unavailable right now — try again shortly.",
    };
  }

  // Both must hold for a camera submission — the habit judgment and the random-challenge check
  // are scored independently (see lib/gemini.ts) specifically so a stale/staged photo that nails
  // the habit content but can't show today's gesture still fails. appSummary submissions have no
  // gesture to check (a screenshot can't show one) — verified alone decides it there.
  const overallVerified = aiResult.verified && (proofType === "appSummary" || aiResult.challengePassed);
  const reason =
    proofType === "camera" && aiResult.verified && !aiResult.challengePassed
      ? `${aiResult.reason} I couldn't confirm the quick check: "${verifiedChallenge.challenge}" — make sure it's clearly visible and try again.`
      : aiResult.reason;

  let onchainTxHash: string | null = null;

  if (overallVerified && aiResult.confidence >= CONFIDENCE_THRESHOLD) {
    const verifierClient = getVerifierWalletClient();
    if (verifierClient && contractAddresses.habitManager) {
      try {
        const { request: simulated } = await publicClient.simulateContract({
          address: contractAddresses.habitManager,
          abi: abis.habitManager,
          functionName: "completeHabit",
          args: [wallet as `0x${string}`, BigInt(contractIndex)],
          account: verifierClient.account,
        });
        onchainTxHash = await verifierClient.writeContract(simulated);
      } catch (err) {
        // Verification result still stands even if the relay tx fails — surfaced via
        // onchain_tx_hash staying null so the UI/coach can flag "pending on-chain sync".
        console.error("completeHabit relay failed", err);
      }
    }
  }

  await supabase.from("habit_completions").upsert(
    {
      wallet_address: wallet,
      contract_index: contractIndex,
      day,
      image_path: imagePath,
      verified: overallVerified,
      confidence: aiResult.confidence,
      reason,
      onchain_tx_hash: onchainTxHash,
      image_hash: imageHash,
      via_gallery_fallback: viaGalleryFallback ?? false,
      proof_type: proofType,
    },
    { onConflict: "wallet_address,contract_index,day" },
  );

  // Best-effort — clears any backlog of unsettled past days right after an action, same helper
  // /api/state uses on every dashboard load, same after()-not-await reasoning (a backlog means
  // real sequential on-chain writes, too slow to make this request wait on). Today itself never
  // settles here (settle() only ever advances past days), but this catches up anything owed.
  after(async () => {
    try {
      // Catches this same request's completeHabit relay too, if the synchronous attempt above
      // failed — plus any other habit slot verified earlier today that never made it on-chain.
      await relayPendingCompletions(wallet as `0x${string}`);
      await settlePendingDays(wallet as `0x${string}`);
    } catch {
      // ignore
    }
  });

  return NextResponse.json({
    verified: overallVerified,
    confidence: aiResult.confidence,
    reason,
    onchainTxHash,
  });
}
