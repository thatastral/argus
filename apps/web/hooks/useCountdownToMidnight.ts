"use client";

import { useEffect, useState } from "react";

function msUntilNextUtcMidnight() {
  const now = new Date();
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return nextMidnight - now.getTime();
}

function format(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}H:${pad(minutes)}M:${pad(seconds)}S`;
}

/// Live countdown to the next UTC day boundary — matches HabitManager's on-chain notion of
/// "today" exactly (`_today() = block.timestamp / 1 days`, integer division truncating to a
/// UTC day index), not an arbitrary client-clock guess at "midnight."
export function useCountdownToMidnight() {
  const [label, setLabel] = useState(() => format(msUntilNextUtcMidnight()));

  useEffect(() => {
    const id = setInterval(() => setLabel(format(msUntilNextUtcMidnight())), 1000);
    return () => clearInterval(id);
  }, []);

  return label;
}
