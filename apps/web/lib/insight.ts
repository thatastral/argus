const MIN_SAMPLES = 5;

function formatHour(hour24: number): string {
  const h = ((hour24 % 24) + 24) % 24;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${period}`;
}

/// Deterministic, no model call — a Gemini round-trip on every dashboard load is exactly what
/// this session's own AI-latency work (hardcoded decimals, conditional image attach in the chat
/// route) was trying to cut, so this stays plain arithmetic over data already in Postgres.
/// Pure function, called client-side (app/page.tsx) rather than in /api/state's route handler —
/// `new Date(...).getHours()` reflects whatever timezone it runs in, and the point is *the
/// user's* usual local completion time, not the server's; same reasoning as
/// useCountdownToDeadline.ts's computeCountdown being a plain function called from the client.
export function computeInsight(recentVerifiedTimestamps: string[]): string {
  if (recentVerifiedTimestamps.length < MIN_SAMPLES) {
    return "Complete more habits and Argus will learn your patterns.";
  }

  const hours = recentVerifiedTimestamps.map((iso) => new Date(iso).getHours());
  const avgHour = hours.reduce((sum, h) => sum + h, 0) / hours.length;
  const roundedHour = Math.round(avgHour);
  const label = formatHour(roundedHour);

  if (roundedHour >= 18) {
    return `You usually finish around ${label} — try starting earlier today.`;
  }
  if (roundedHour < 10) {
    return `You're an early finisher — usually done by ${label}. Keep it up.`;
  }
  return `You usually complete habits around ${label}.`;
}
