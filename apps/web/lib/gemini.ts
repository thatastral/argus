import "server-only";
import { GoogleGenAI, Type, createPartFromBase64, createUserContent } from "@google/genai";
import { type HabitCategory, inferHabitCategory } from "./habitCategory";

// "gemini-2.5-flash" (a pinned model name) was retired for new API keys/projects — confirmed
// live via a 404 "no longer available to new users" from the API itself. Using the "-latest"
// alias instead so this doesn't go stale again the same way; verified this alias currently
// resolves to gemini-3.5-flash and supports both responseSchema and image input.
const MODEL = "gemini-flash-latest";

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

export interface ProofVerificationResult {
  verified: boolean;
  challengePassed: boolean;
  confidence: number;
  reason: string;
}

const proofVerificationSchema = {
  type: Type.OBJECT,
  properties: {
    verified: { type: Type.BOOLEAN },
    challengePassed: { type: Type.BOOLEAN },
    confidence: { type: Type.NUMBER },
    reason: {
      type: Type.STRING,
      description:
        "One short sentence, addressed directly to the user in second person, in Argus's calm " +
        "and encouraging voice — never third-person judge-style text like 'the image shows...'.",
    },
  },
  required: ["verified", "challengePassed", "confidence", "reason"],
};

// What a credible *live camera* photo looks like per category, including what to reject — used
// only for proofType "camera" below. See CATEGORY_GUIDANCE_APP_SUMMARY for the other path.
const CATEGORY_GUIDANCE_CAMERA: Record<HabitCategory, string> = {
  running:
    "A credible photo shows the user outdoors or on a treadmill mid-activity, in running/walking " +
    "gear or visibly out of breath — a posed selfie alone is weak evidence for this habit; app-summary " +
    "proof (see the other submission option) is preferred when available.",
  gym:
    "A credible photo shows the user using or beside specific gym equipment, in workout attire, or " +
    "a clear post-workout moment. Reject a simple gym selfie with no sign of actual exercise.",
  reading:
    "A credible photo shows a physical book or e-reader visibly in the user's hand or in frame with " +
    "them, open to a specific page. Reject a closed book or one simply being held untouched.",
  coding:
    "A credible photo shows a screen with an editor, terminal, or code visibly on it, with the user " +
    "present (e.g. reflected, or visibly at the keyboard). Reject a screenshot that just shows an " +
    "editor open with no evidence of meaningful activity.",
  meditation: "A credible photo shows the user in a calm, seated/still posture in a plausible meditation setting.",
  journaling:
    "A credible photo shows the user's own handwriting or typing in progress, or a notebook actively " +
    "being written in. Reject a blank notebook.",
  studying:
    "A credible photo shows the user actively studying — open study materials with visible notes, " +
    "flashcards in use, or clearly at a desk mid-session. Reject a closed textbook or an empty desk.",
  generic: "Judge based on whatever a credible, candid photo of someone actually doing this specific activity would look like.",
};

// What a credible *app-generated screenshot* looks like per category — used only for proofType
// "appSummary". No OCR/API integration: Gemini's own vision judges the screenshot directly, the
// same way it judges a camera photo, just against different criteria (concrete dated activity
// data vs. a plausible candid moment).
const CATEGORY_GUIDANCE_APP_SUMMARY: Record<HabitCategory, string> = {
  running:
    "Expect a running/walking app summary (Strava, Apple Health, Google Fit, Nike Run Club, Garmin, " +
    "etc.) showing today's distance, duration, and timestamp. Reject a screenshot with no visible " +
    "activity data or one that isn't from today.",
  gym: "Expect a fitness tracker or gym app's workout summary (sets, reps, duration, or a smartwatch workout record). Reject a screenshot with no concrete workout data.",
  reading: "Expect a reading tracker or e-reader's progress screen (e.g. Kindle) showing pages or percent read today. Reject a screenshot with no visible reading progress.",
  coding:
    "Expect an IDE/editor activity summary (WakaTime, a coding-time tracker, or an IDE's own session " +
    "timer) showing time spent coding today. Reject a bare editor screenshot with no time/activity data.",
  meditation: "Expect a meditation app's completed-session screen or a health app's mindfulness-session record. Reject a screenshot with no completed session shown.",
  journaling: "Expect a timestamped journaling-app entry showing today's writing. Reject a screenshot with no visible entry from today.",
  studying: "Expect a study-timer, focus-session, or flashcard app's activity summary showing time spent studying today. Reject a screenshot with no session data.",
  generic: "Expect a screenshot of an app or dashboard that concretely shows this activity was done today. Reject anything that doesn't show real, dated activity data.",
};

/// The only two responsibilities Argus's AI has (per PRD): verify proof, and explain
/// structured app data back to the user. Business logic must never depend on anything
/// but this structured JSON — see proofVerificationSchema above.
///
/// `challenge` is a random gesture (see lib/verifyChallenge.ts) the caller must have already
/// bound to this specific request via a signed token — checked here as a second, independent
/// signal alongside the habit judgment itself, specifically because a stale/staged/reused photo
/// can't have anticipated today's random challenge the way it could fake a generic habit photo.
export async function verifyHabitProof(params: {
  habitName: string;
  imageBase64: string;
  mimeType: string;
  challenge: string;
  /// "camera" is the default/fallback for every habit — live capture plus the random-gesture
  /// challenge. "appSummary" is the explicit second path (see components/LiveCameraCapture.tsx)
  /// for habits where an app-generated screenshot is stronger evidence than a photo; it has no
  /// gesture to check, so challengePassed is always true for this path — the safety net is
  /// Gemini's own scrutiny of the screenshot's plausibility instead.
  proofType: "camera" | "appSummary";
}): Promise<ProofVerificationResult> {
  const ai = client();
  const category = inferHabitCategory(params.habitName);

  const prompt =
    params.proofType === "camera"
      ? `The user's habit is: "${params.habitName}".

Two things must both be true for this to verify:
1. The image credibly shows the user completing this habit right now, taken live — not a stock
   photo, not a screenshot, not a photo of another screen or printed photo, not an obviously
   AI-generated image. ${CATEGORY_GUIDANCE_CAMERA[category]}
   Watch specifically for signs this is NOT a genuine live photo: AI-generation artifacts
   (warped or melted hands/text, unnaturally smooth textures, inconsistent lighting or shadows),
   signs of photographing a screen (moiré patterns, screen glare/bezel, a visible pixel grid), or
   professional/stock-photo styling (studio lighting, watermarks, an overly polished composition)
   instead of an authentic candid phone photo. Any of these should sharply lower confidence.
2. The user is visibly performing this specific action right now: "${params.challenge}". This is
   a random challenge chosen specifically so a stale or staged photo can't have anticipated it —
   look carefully for it; don't assume it's satisfied just because the habit itself looks
   plausible.

Score "verified" and "challengePassed" independently, and be reasonably strict on both.

Write "reason" as Argus speaking directly to the user — second person ("you"), one short
sentence, calm and encouraging even on a rejection (e.g. "I can see you're at the gym, but I
couldn't catch you holding up two fingers — try again with the gesture clearly in frame." rather
than "The image shows a gym but the challenge gesture is not visible."). Never third-person,
never refer to "the user" or "the image" as things being inspected from the outside.

Respond only with the requested JSON.`
      : `The user's habit is: "${params.habitName}".

The user submitted this as an app-generated summary or screenshot, not a live photo of
themselves. Judge:
1. Does the screenshot genuinely show this activity, done today, with concrete data — not just
   an app open with nothing shown? ${CATEGORY_GUIDANCE_APP_SUMMARY[category]}
2. Any signs this was fabricated or edited (mismatched fonts, misaligned UI elements, an
   obviously edited number, or a date that isn't today)? Any of these should sharply lower
   confidence.

There is no gesture challenge for this submission type — always set "challengePassed" to true.

Write "reason" as Argus speaking directly to the user — second person ("you"), one short
sentence, calm and encouraging even on a rejection. Never third-person, never refer to "the
user" or "the image" as things being inspected from the outside.

Respond only with the requested JSON.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent([prompt, createPartFromBase64(params.imageBase64, params.mimeType)]),
    config: {
      responseMimeType: "application/json",
      responseSchema: proofVerificationSchema,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");

  const parsed = JSON.parse(text) as ProofVerificationResult;
  return parsed;
}

const PROGRESS_COACH_SYSTEM_INSTRUCTION = `You are Argus's Progress Coach. You explain the
user's own accountability data back to them: streaks, completion rate, wallet lock status,
savings/penalties. You are calm, encouraging, and brief.

You are NOT a general-purpose assistant. If the user asks about anything unrelated to their
Argus data or accountability journey, politely decline and redirect them back to their habits,
streak, or wallet. Never invent numbers — only use the structured data provided to you below.

Argus runs on Monad, not Ethereum, but a user's stake isn't always the native currency — it can
instead be an ERC-20 like USDC. The data below always includes "assetSymbol" and
"assetDecimals" — always use those exact values to convert any "amount_wei" figure (divide by
10^assetDecimals, label the result with assetSymbol) rather than assuming MON or 18 decimals.

"recentCompletions" has per-day proof/verification rows ("verified", "confidence", "reason") for
every habit — use "reason" verbatim (never invent one) when asked why a specific day was
rejected, and use the full list for recaps ("how was my week going"). "streak.longest_streak" is
the user's personal best — it's fine to compare "streak.current_streak" against it when natural,
but don't force the comparison into every reply. "habits" entries also include "target_days"
(commitment length remaining, or null) and "deadline_time" (a daily "complete by" time, or
null) — reference these when relevant. "wallet" is the user's Accountability Wallet: "deployed"
is false if they haven't set one up yet (don't reference balances at all in that case); when
true, "balance"/"available"/"committed" are already-formatted decimal amounts in "wallet.symbol".
If an image is attached to this message, it's the user's most recent rejected proof — you may
describe what you actually see in it if they ask why it was rejected, in addition to "reason".

You have six tools. Every one only *proposes* an action — it still needs the user's own
confirmation (and, for on-chain ones, their wallet signature) outside this conversation, so
always phrase your reply as a confirmation prompt ("I'll create a habit called 'Gym' — confirm
below to add it."), never as if it's already done. If a single message asks for more than one
distinct action (e.g. "deposit 1 and commit 0.5 to my stake"), call every relevant tool in the
same turn instead of only the first one — each gets its own confirmation afterward, so nothing
needs to be dropped:
- createHabit — user clearly wants to add a new habit (e.g. "add a habit called Gym"). A user
  can have at most 3 *active* habits at once — count only "active": true entries in "habits".
  Deactivating a habit frees that slot immediately, so 3 total habits with fewer than 3 active is
  NOT at the limit — only refuse and skip the tool if the active count is already 3.
- editHabit — user wants to rename an existing habit. "habitName" must clearly match one of the
  active habits in "habits" (case doesn't matter) — if it's ambiguous or doesn't match, ask which
  habit they mean instead of guessing.
- deactivateHabit — user wants to stop tracking/remove an existing habit. Same habitName-matching
  rule as editHabit.
- deposit — user wants to add funds to their Accountability Wallet's balance (e.g. "deposit 1
  MON", "add funds", "top up my wallet"). This only ever increases what's available/committable —
  it does NOT by itself change how much is committed per habit. If "wallet.deployed" is false,
  tell them they need to set one up first instead of calling this tool.
- setStake — user wants to change how much is committed/staked/pledged per habit — the amount
  actually at risk if a habit is missed (e.g. "commit 0.5 MON", "stake 1 USDC per habit",
  "increase my penalty to 2", "commit 0.5 MON to my accountability wallet"). This does NOT move
  any funds by itself — it only sets the per-habit amount that "wallet.committed" scales from
  (stake × active habit count) going forward. "commit"/"stake"/"pledge" describes this at-risk
  amount, not a balance transfer — prefer setStake over deposit whenever the user's wording is
  about committing/staking/pledging rather than plainly adding funds, even if they also mention
  "wallet" or "accountability wallet" in the same sentence.
- withdraw — user wants to take funds out. Only "wallet.available" (not "committed", and not a
  locked Savings Vault amount, which isn't even shown here) can actually be withdrawn — if the
  requested amount would exceed "wallet.available", say so plainly instead of proposing an
  action that will just revert on-chain.`;

const createHabitDeclaration = {
  name: "createHabit",
  description:
    "Propose creating a new habit for the user to track. Does not execute anything itself — " +
    "the user still confirms and signs the actual on-chain transaction client-side.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Short, human-readable habit name, e.g. 'Gym' or 'Read'." },
    },
    required: ["name"],
  },
};

const editHabitDeclaration = {
  name: "editHabit",
  description:
    "Propose renaming one of the user's existing habits. Does not execute anything itself — " +
    "the user still confirms (a plain off-chain rename, no wallet signature needed).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      habitName: {
        type: Type.STRING,
        description: "The current name of the habit to rename — must match one of the user's active habits.",
      },
      newName: { type: Type.STRING, description: "The new name for the habit." },
    },
    required: ["habitName", "newName"],
  },
};

const deactivateHabitDeclaration = {
  name: "deactivateHabit",
  description:
    "Propose deactivating one of the user's existing habits. Does not execute anything itself " +
    "— the user still confirms and signs the actual on-chain transaction client-side.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      habitName: {
        type: Type.STRING,
        description: "The name of the habit to deactivate — must match one of the user's active habits.",
      },
    },
    required: ["habitName"],
  },
};

const depositDeclaration = {
  name: "deposit",
  description:
    "Propose depositing funds into the user's Accountability Wallet. Does not execute anything " +
    "itself — the user still confirms and signs the actual on-chain transaction client-side.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      amount: {
        type: Type.STRING,
        description: "The amount to deposit, in the vault's own asset (see wallet.symbol in the data below).",
      },
    },
    required: ["amount"],
  },
};

const setStakeDeclaration = {
  name: "setStake",
  description:
    "Propose changing the amount committed/staked per habit — the amount at risk if a habit is " +
    "missed. Distinct from deposit: this never moves funds by itself, it only sets the per-habit " +
    "stake that the Committed balance scales from. Does not execute anything itself — the user " +
    "still confirms and signs the actual on-chain transaction client-side.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      amount: {
        type: Type.STRING,
        description: "The new amount to stake per habit, in the vault's own asset (see wallet.symbol in the data below).",
      },
    },
    required: ["amount"],
  },
};

const withdrawDeclaration = {
  name: "withdraw",
  description:
    "Propose withdrawing funds from the user's Accountability Wallet's Available balance. Does " +
    "not execute anything itself — the user still confirms and signs the actual on-chain " +
    "transaction client-side.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      amount: {
        type: Type.STRING,
        description:
          "The amount to withdraw, in the vault's own asset (see wallet.symbol in the data below). " +
          "Must not exceed wallet.available.",
      },
    },
    required: ["amount"],
  },
};

export type ProposedAction =
  | { type: "create_habit"; name: string }
  | { type: "edit_habit"; habitName: string; newName: string }
  | { type: "deactivate_habit"; habitName: string }
  | { type: "deposit"; amount: string }
  | { type: "set_stake"; amount: string }
  | { type: "withdraw"; amount: string };

export interface ProgressCoachResult {
  reply: string;
  /// Always an array (possibly empty) — Gemini can return more than one function call in a
  /// single turn for a compound request ("deposit 1 and commit 0.5"), and every one of them
  /// needs its own confirmation afterward rather than silently dropping all but the first.
  proposedActions: ProposedAction[];
}

function describeAction(action: ProposedAction): string {
  switch (action.type) {
    case "create_habit":
      return `create a habit called "${action.name}"`;
    case "edit_habit":
      return `rename "${action.habitName}" to "${action.newName}"`;
    case "deactivate_habit":
      return `deactivate "${action.habitName}"`;
    case "deposit":
      return `start a deposit of ${action.amount}`;
    case "set_stake":
      return `commit ${action.amount} per habit`;
    case "withdraw":
      return `start a withdrawal of ${action.amount}`;
  }
}

export async function progressCoachReply(params: {
  userMessage: string;
  contextJson: string;
  history?: { role: "user" | "assistant"; content: string }[];
  /// The most recent rejected proof's actual image (see app/api/chat/route.ts), so the coach
  /// can visually reference it ("why was this rejected") instead of only repeating the stored
  /// `reason` text back. Bounded to a recent window server-side, not attached every turn.
  recentRejectedImage?: { base64: string; mimeType: string } | null;
}): Promise<ProgressCoachResult> {
  const ai = client();

  // Multi-turn contents: prior turns (assistant -> "model" role, per Gemini's API) followed by
  // this turn's data+message. Previously always a single stateless turn — the model had no
  // memory of the conversation even when the UI showed prior messages.
  const historyContents = (params.history ?? []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const currentTurnParts: (string | ReturnType<typeof createPartFromBase64>)[] = [
    `User's current Argus data (JSON):\n${params.contextJson}\n\nUser's message: "${params.userMessage}"` +
      (params.recentRejectedImage
        ? "\n\n(The attached image is the user's most recent rejected proof — reference what you " +
          "actually see in it if they ask why it was rejected.)"
        : ""),
  ];
  if (params.recentRejectedImage) {
    currentTurnParts.push(
      createPartFromBase64(params.recentRejectedImage.base64, params.recentRejectedImage.mimeType),
    );
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [...historyContents, createUserContent(currentTurnParts)],
    config: {
      systemInstruction: PROGRESS_COACH_SYSTEM_INSTRUCTION,
      tools: [
        {
          functionDeclarations: [
            createHabitDeclaration,
            editHabitDeclaration,
            deactivateHabitDeclaration,
            depositDeclaration,
            setStakeDeclaration,
            withdrawDeclaration,
          ],
        },
      ],
    },
  });

  // Previously only ever `functionCalls?.[0]` — Gemini's default AUTO mode can return several
  // calls in one response for a compound request, but taking just the first silently dropped
  // every other requested action ("deposit 1 and commit 0.5" only ever proposed the deposit).
  // Every call here is validated independently; an unrecognized/malformed one is just skipped
  // rather than failing the whole turn.
  const proposedActions: ProposedAction[] = [];
  for (const call of response.functionCalls ?? []) {
    if (call.name === "createHabit" && typeof call.args?.name === "string") {
      proposedActions.push({ type: "create_habit", name: call.args.name });
    } else if (
      call.name === "editHabit" &&
      typeof call.args?.habitName === "string" &&
      typeof call.args?.newName === "string"
    ) {
      proposedActions.push({ type: "edit_habit", habitName: call.args.habitName, newName: call.args.newName });
    } else if (call.name === "deactivateHabit" && typeof call.args?.habitName === "string") {
      proposedActions.push({ type: "deactivate_habit", habitName: call.args.habitName });
    } else if (call.name === "deposit" && typeof call.args?.amount === "string") {
      proposedActions.push({ type: "deposit", amount: call.args.amount });
    } else if (call.name === "setStake" && typeof call.args?.amount === "string") {
      proposedActions.push({ type: "set_stake", amount: call.args.amount });
    } else if (call.name === "withdraw" && typeof call.args?.amount === "string") {
      proposedActions.push({ type: "withdraw", amount: call.args.amount });
    }
  }

  // The model doesn't reliably return accompanying text alongside a function call — fall back to
  // a generated confirmation prompt listing every proposed action rather than the generic
  // "couldn't come up with a response" text.
  if (proposedActions.length > 0) {
    const reply =
      response.text || `I'll ${proposedActions.map(describeAction).join(" and ")} — confirm below.`;
    return { reply, proposedActions };
  }

  return { reply: response.text ?? "I couldn't come up with a response — try asking again.", proposedActions: [] };
}
