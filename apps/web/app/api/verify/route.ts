import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyHabitProof } from "@/lib/gemini";
import { getVerifierWalletClient, publicClient, contractAddresses } from "@/lib/chain";
import { abis } from "@/lib/contracts";

const CONFIDENCE_THRESHOLD = 0.7;

const bodySchema = z.object({
  contractIndex: z.number().int().min(0).max(2),
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
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
  const { contractIndex, imageBase64, mimeType } = parsed.data;

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

  const result = await verifyHabitProof({ habitName: habit.name, imageBase64, mimeType });

  let onchainTxHash: string | null = null;

  if (result.verified && result.confidence >= CONFIDENCE_THRESHOLD) {
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
      verified: result.verified,
      confidence: result.confidence,
      reason: result.reason,
      onchain_tx_hash: onchainTxHash,
    },
    { onConflict: "wallet_address,contract_index,day" },
  );

  return NextResponse.json({ ...result, onchainTxHash });
}
