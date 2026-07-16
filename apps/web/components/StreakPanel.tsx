"use client";

import { useStreak } from "@/hooks/useStreak";

const CARD_SIZE = 1080;

/// Renders the streak card to an offscreen canvas and triggers a PNG download. Canvas rather
/// than an html-to-image library — no extra dependency, and the design constraints (PRD:
/// white/black/grey only, no gradients/decoration) map directly onto plain 2D canvas drawing.
function downloadStreakCard(params: {
  displayName: string;
  currentStreak: number;
  longestStreak: number;
  completionRateBps: number;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_SIZE;
  canvas.height = CARD_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);

  ctx.fillStyle = "#ededed";
  ctx.textAlign = "center";

  ctx.font = "600 40px system-ui, sans-serif";
  ctx.fillText("ARGUS", CARD_SIZE / 2, 140);

  ctx.font = "700 320px system-ui, sans-serif";
  ctx.fillText(String(params.currentStreak), CARD_SIZE / 2, 560);

  ctx.font = "500 36px system-ui, sans-serif";
  ctx.fillStyle = "#9a9a9a";
  ctx.fillText("DAY STREAK", CARD_SIZE / 2, 630);

  ctx.font = "500 32px system-ui, sans-serif";
  ctx.fillStyle = "#ededed";
  ctx.fillText(
    `Best ${params.longestStreak}d · ${(params.completionRateBps / 100).toFixed(0)}% completion`,
    CARD_SIZE / 2,
    780,
  );

  if (params.displayName) {
    ctx.font = "400 28px system-ui, sans-serif";
    ctx.fillStyle = "#6b6b6b";
    ctx.fillText(params.displayName, CARD_SIZE / 2, 960);
  }

  const link = document.createElement("a");
  link.download = "argus-streak.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function StreakPanel({ displayName }: { displayName: string }) {
  const { currentStreak, longestStreak, completionRateBps, settleToday, settling, settleMessage } = useStreak();

  const hasData = currentStreak !== undefined;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-6xl font-semibold tabular-nums">{hasData ? currentStreak : "—"}</p>
        <p className="mt-1 font-mono text-xs uppercase tracking-wide text-muted">day streak</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-4 text-center">
          <p className="text-2xl font-medium tabular-nums">{hasData ? longestStreak : "—"}</p>
          <p className="mt-1 font-mono text-xs uppercase tracking-wide text-muted">longest</p>
        </div>
        <div className="rounded-lg border border-border p-4 text-center">
          <p className="text-2xl font-medium tabular-nums">
            {hasData ? `${(completionRateBps! / 100).toFixed(0)}%` : "—"}
          </p>
          <p className="mt-1 font-mono text-xs uppercase tracking-wide text-muted">completion</p>
        </div>
      </div>

      <button
        onClick={() =>
          downloadStreakCard({
            displayName,
            currentStreak: currentStreak ?? 0,
            longestStreak: longestStreak ?? 0,
            completionRateBps: completionRateBps ?? 0,
          })
        }
        disabled={!hasData}
        className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
      >
        Download shareable card
      </button>

      <div className="rounded-md border border-border bg-surface p-3">
        <p className="text-xs text-muted">
          No automatic daily settlement is running yet — use this to close out a finished day and update your
          streak.
        </p>
        <button
          onClick={settleToday}
          disabled={settling}
          className="mt-2 w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
        >
          {settling ? "Settling…" : "Settle today"}
        </button>
        {settleMessage && <p className="mt-2 text-xs text-muted">{settleMessage}</p>}
      </div>
    </div>
  );
}
