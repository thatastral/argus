"use client";

import { DownloadSimple } from "@phosphor-icons/react";
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
  const { currentStreak, longestStreak, completionRateBps } = useStreak();

  const hasData = currentStreak !== undefined;

  return (
    // One visual card matching downloadStreakCard's own art direction (dark surface, centered
    // wordmark/number/label stack) so the on-screen preview and the actual downloaded PNG read
    // as the same object, not three separate stat boxes plus an unrelated button underneath.
    <div className="group relative overflow-hidden rounded-2xl bg-[#0d0d0d] px-6 py-10 text-center">
      <p className="text-xs font-semibold tracking-[0.3em] text-white/70">ARGUS</p>
      <p className="mt-6 text-7xl font-bold tabular-nums text-[#ededed]">{hasData ? currentStreak : "—"}</p>
      <p className="mt-2 text-sm font-medium uppercase tracking-wide text-white/60">Day streak</p>
      <p className="mt-4 text-sm text-[#ededed]">
        {hasData ? `Best ${longestStreak}d · ${(completionRateBps! / 100).toFixed(0)}% completion` : "—"}
      </p>
      {displayName && <p className="mt-6 text-xs text-white/40">{displayName}</p>}

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
        aria-label="Download shareable card"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-[opacity,transform] duration-150 ease-emil-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
      >
        <DownloadSimple size={16} weight="bold" />
      </button>
    </div>
  );
}
