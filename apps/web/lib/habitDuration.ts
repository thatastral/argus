export const DURATION_PRESETS: { label: string; days: number | null }[] = [
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "No end date", days: null },
];

// A habit with targetDays set (including the "Pick a date" custom path, minimum 1 day) is only
// ever configured to recur through its own end date — `dayIndex` (a day-since-epoch index, same
// units as habits.created_at converted via the same /86_400_000 truncation used everywhere else
// in this codebase) belongs to it only up to createdDayIndex + targetDays - 1. `targetDays: null`
// ("No end date") is the one case actually configured to recur indefinitely. Without this bound,
// e.g. a 1-day habit kept reappearing as "today's habit" forever after its single configured day,
// since nothing else ever stopped it from recurring.
export function isWithinHabitDuration(createdAt: string, targetDays: number | null, dayIndex: number): boolean {
  if (targetDays === null) return true;
  const createdDayIndex = Math.floor(new Date(createdAt).getTime() / 86_400_000);
  return dayIndex < createdDayIndex + targetDays;
}
