// Deliberately has no "server-only" marker (unlike lib/gemini.ts) — this is shared between the
// server-side verification prompt and the client-side capture UI's category-aware copy, so it
// has to be safe to bundle into the browser. Keyword-based, not a setup-flow field — sharpens
// the common cases without adding UI or a schema change; anything that doesn't match a keyword
// falls back to "generic," never blocks.
export type HabitCategory =
  | "running"
  | "gym"
  | "reading"
  | "coding"
  | "meditation"
  | "journaling"
  | "studying"
  | "generic";

const CATEGORY_KEYWORDS: Record<Exclude<HabitCategory, "generic">, string[]> = {
  running: ["run", "running", "jog", "jogging", "walk", "walking"],
  gym: ["gym", "workout", "exercise", "lift", "weights", "yoga", "fitness", "cardio", "sport", "training"],
  reading: ["read", "book", "novel", "chapter"],
  coding: ["code", "coding", "program", "dev", "leetcode", "software"],
  meditation: ["meditat", "mindful", "breathe", "breathing"],
  journaling: ["journal", "write", "writing", "diary", "log"],
  studying: ["study", "studying", "homework", "exam", "revise", "revision", "flashcard", "class", "lecture"],
};

export function inferHabitCategory(habitName: string): HabitCategory {
  const lower = habitName.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [
    Exclude<HabitCategory, "generic">,
    string[],
  ][]) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "generic";
}

/// Shown in the capture UI to nudge users toward whichever proof type is actually strongest for
/// their specific habit, per the product doc's "prioritize activity evidence over posed photos"
/// principle — the live camera stays fully available either way, this is guidance, not a gate.
export const CATEGORY_PROOF_HINT: Record<HabitCategory, string> = {
  running:
    "A screenshot of your running app's summary (distance, time, today's date — Strava, Apple Health, Google Fit, etc.) is the strongest proof for this habit.",
  gym: "A fitness tracker or gym app's workout summary is the strongest proof for this habit.",
  reading: "A screenshot of your reading app's progress (e.g. Kindle) is the strongest proof for this habit.",
  coding: "A screenshot of your coding-time tracker (e.g. WakaTime) is the strongest proof for this habit.",
  meditation: "A screenshot of your meditation app's completed session is the strongest proof for this habit.",
  journaling: "A screenshot of a timestamped journal entry works well here too.",
  studying: "A screenshot of your study-timer or flashcard app's session summary is the strongest proof for this habit.",
  generic: "If there's an app that tracks this habit, a screenshot of it is often stronger proof than a photo.",
};
