import "server-only";
import { GoogleGenAI, Type, createPartFromBase64, createUserContent } from "@google/genai";

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
  confidence: number;
  reason: string;
}

const proofVerificationSchema = {
  type: Type.OBJECT,
  properties: {
    verified: { type: Type.BOOLEAN },
    confidence: { type: Type.NUMBER },
    reason: { type: Type.STRING },
  },
  required: ["verified", "confidence", "reason"],
};

/// The only two responsibilities Argus's AI has (per PRD): verify proof, and explain
/// structured app data back to the user. Business logic must never depend on anything
/// but this structured JSON — see proofVerificationSchema above.
export async function verifyHabitProof(params: {
  habitName: string;
  imageBase64: string;
  mimeType: string;
}): Promise<ProofVerificationResult> {
  const ai = client();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent([
      `The user's habit is: "${params.habitName}". Does this image credibly show the user ` +
        `completing this habit today? Be reasonably strict: a stock photo, a screenshot of ` +
        `unrelated content, or an image with no clear connection to the habit should not be ` +
        `verified. Respond only with the requested JSON.`,
      createPartFromBase64(params.imageBase64, params.mimeType),
    ]),
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

Argus runs on Monad, not Ethereum — the native currency is MON, never ETH. Any "amount_wei"
value is in wei (18 decimals) unless the data explicitly says otherwise; convert it to a
human-readable MON amount yourself (e.g. divide by 10^18) rather than repeating the raw integer.`;

export async function progressCoachReply(params: {
  userMessage: string;
  contextJson: string;
}): Promise<string> {
  const ai = client();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent(
      `User's current Argus data (JSON):\n${params.contextJson}\n\nUser's message: "${params.userMessage}"`,
    ),
    config: {
      systemInstruction: PROGRESS_COACH_SYSTEM_INSTRUCTION,
    },
  });

  return response.text ?? "I couldn't come up with a response — try asking again.";
}
