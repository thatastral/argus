import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getSessionWallet } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { progressCoachReply } from "@/lib/gemini";
import { getVaultSnapshot } from "@/lib/chain";
import type { PenaltyType } from "@/lib/penalty";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
});

const HISTORY_WINDOW = 10;

// What actually reaches the client — habitName (the model's natural-language reference) is
// replaced with a resolved contractIndex before this ever leaves the server; see the POST
// handler below. set_stake's penaltyType/assetSymbol/assetDecimals are resolved here too, the
// same way, rather than trusting the model with contract-level enum/precision values.
type ResolvedAction =
  | { type: "create_habit"; name: string }
  | { type: "edit_habit"; contractIndex: number; currentName: string; newName: string }
  | { type: "deactivate_habit"; contractIndex: number; name: string }
  | { type: "deposit"; amount: string }
  | { type: "set_stake"; amount: string; penaltyType: PenaltyType; assetSymbol: string; assetDecimals: number }
  | { type: "withdraw"; amount: string };

export async function GET() {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  // Most recent N, returned oldest-first for the UI to render top-to-bottom directly.
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "Failed to load chat history" }, { status: 500 });
  }

  return NextResponse.json({ messages: (data ?? []).reverse() });
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

  const [
    { data: user },
    { data: habits },
    { data: streak },
    { data: penalty },
    { data: recentSettlements },
    { data: recentCompletions },
    { data: history },
    vault,
  ] = await Promise.all([
    supabase.from("users").select("display_name, accountability_wallet_address").eq(
      "wallet_address",
      wallet,
    ).maybeSingle(),
    // target_days/deadline_time (migrations 0002/0004) let the coach reference commitment
    // length and daily deadlines, not just name/active.
    supabase.from("habits").select("contract_index, name, active, target_days, deadline_time").eq(
      "wallet_address",
      wallet,
    ),
    supabase.from("streak_cache").select("*").eq("wallet_address", wallet).maybeSingle(),
    // amount_wei cast to text — see /api/state/route.ts for why (JSON-number precision loss).
    // asset_symbol/asset_decimals (migration 0002) is what tells the model the real currency
    // and decimal count instead of assuming 18-decimal MON — see the system instruction.
    supabase
      .from("penalty_configs")
      .select("penalty_type, amount_wei::text, asset_symbol, asset_decimals")
      .eq("wallet_address", wallet)
      .maybeSingle(),
    supabase
      .from("daily_settlements")
      .select("day, success, resolved_penalty_type")
      .eq("wallet_address", wallet)
      .order("day", { ascending: false })
      .limit(14),
    // Per-habit proof/verification history — lets the coach explain a specific rejection
    // ("reason") or synthesize a recap, rather than only ever seeing aggregate streak numbers.
    // image_path isn't put in contextJson (the model can't follow a storage path) — it's only
    // used below to fetch the actual image bytes for a recent rejection, if any.
    supabase
      .from("habit_completions")
      .select("contract_index, day, verified, confidence, reason, image_path")
      .eq("wallet_address", wallet)
      .order("day", { ascending: false })
      .limit(30),
    supabase
      .from("chat_messages")
      .select("role, content")
      .eq("wallet_address", wallet)
      .order("created_at", { ascending: false })
      .limit(HISTORY_WINDOW),
    // On-chain read, not Supabase — see lib/chain.ts's doc comment. Needed so the coach knows
    // Available before proposing a withdraw (Committed/locked Savings-Vault funds would just
    // revert on-chain otherwise).
    getVaultSnapshot(wallet as `0x${string}`),
  ]);

  const contextJson = JSON.stringify({
    displayName: user?.display_name ?? null,
    habits: habits ?? [],
    streak: streak ?? { current_streak: 0, longest_streak: 0, completion_rate_bps: 0 },
    penalty: penalty ?? null,
    assetSymbol: penalty?.asset_symbol ?? "MON",
    assetDecimals: penalty?.asset_decimals ?? 18,
    recentSettlements: recentSettlements ?? [],
    // image_path stripped — it's a storage path, not something the model can act on; the actual
    // image bytes for a recent rejection (if any) are attached separately below.
    recentCompletions: (recentCompletions ?? []).map((c) => ({
      contract_index: c.contract_index,
      day: c.day,
      verified: c.verified,
      confidence: c.confidence,
      reason: c.reason,
    })),
    wallet: vault
      ? { deployed: true, symbol: vault.symbol, balance: vault.balance, available: vault.available, committed: vault.committed }
      : { deployed: false },
  });

  // If the most recent proof (today or yesterday) was rejected, attach the actual image so the
  // coach can answer "why was that rejected" by looking at it, not just repeating `reason` back.
  // Bounded to a 2-day window, only when a genuine rejection exists, AND only when this message
  // plausibly asks about it — the Storage download was previously unconditional within the
  // window, adding a round-trip to every single turn (including "what's my streak") for however
  // long a rejection sat in that window, which was a real contributor to slow replies.
  const asksAboutRejection = /reject|why|photo|proof|fail/i.test(parsed.data.message);
  let recentRejectedImage: { base64: string; mimeType: string } | null = null;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const recentRejection =
    asksAboutRejection &&
    (recentCompletions ?? []).find((c) => !c.verified && (c.day === today || c.day === yesterday));
  if (recentRejection) {
    const { data: imageBlob } = await supabase.storage.from("proofs").download(recentRejection.image_path);
    if (imageBlob) {
      const buffer = Buffer.from(await imageBlob.arrayBuffer());
      // Content-type isn't stored per-completion — proofs are overwhelmingly JPEG (canvas
      // capture or a typical phone photo), so this is a reasonable default rather than a new
      // migration just for this.
      recentRejectedImage = { base64: buffer.toString("base64"), mimeType: "image/jpeg" };
    }
  }

  let reply: string;
  let proposedActions: ResolvedAction[] = [];
  try {
    const result = await progressCoachReply({
      userMessage: parsed.data.message,
      contextJson,
      history: (history ?? []).reverse() as { role: "user" | "assistant"; content: string }[],
      recentRejectedImage,
    });
    reply = result.reply;

    // The model only ever names a habit by its display name, and never decides penaltyType/
    // asset precision itself (see lib/gemini.ts) — resolve both here, server-side, against data
    // already fetched for context, rather than ever trusting a value the model might hallucinate.
    // A habit-name action that matches nothing is silently dropped; every other action type
    // always resolves (set_stake has no matching-failure case — it just needs the current
    // penalty config, same defaults contextJson above already uses).
    proposedActions = result.proposedActions.flatMap((raw): ResolvedAction[] => {
      if (raw.type === "edit_habit" || raw.type === "deactivate_habit") {
        const match = (habits ?? []).find(
          (h) => h.active && h.name.toLowerCase() === raw.habitName.toLowerCase(),
        );
        if (!match) return [];
        return raw.type === "edit_habit"
          ? [{ type: "edit_habit", contractIndex: match.contract_index, currentName: match.name, newName: raw.newName }]
          : [{ type: "deactivate_habit", contractIndex: match.contract_index, name: match.name }];
      }
      if (raw.type === "set_stake") {
        return [
          {
            type: "set_stake",
            amount: raw.amount,
            penaltyType: (penalty?.penalty_type as PenaltyType | undefined) ?? "savingsVault",
            assetSymbol: penalty?.asset_symbol ?? "MON",
            assetDecimals: penalty?.asset_decimals ?? 18,
          },
        ];
      }
      return [raw];
    });
  } catch (err) {
    console.error("progressCoachReply failed", err);
    reply =
      err instanceof Error && err.message.includes("GEMINI_API_KEY")
        ? "The AI coach isn't configured yet — ask whoever runs this app to set GEMINI_API_KEY."
        : "I couldn't reach the AI service just now — try again shortly.";
  }

  // Non-critical audit write — scheduled after the response is sent rather than awaited, same
  // after()-not-await reasoning as lib/chain.ts's settlePendingDays (confirmed live: this insert
  // was previously adding a full extra DB round-trip to the response the user is waiting on).
  after(async () => {
    await supabase.from("chat_messages").insert([
      { wallet_address: wallet, role: "user", content: parsed.data.message },
      { wallet_address: wallet, role: "assistant", content: reply },
    ]);
  });

  return NextResponse.json({ reply, proposedActions });
}
