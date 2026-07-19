"use client";

import Image from "next/image";
import { DownloadSimple } from "@phosphor-icons/react";
import { useStreak } from "@/hooks/useStreak";

const CARD_SIZE = 1080;
// Brand yellow anchor (globals.css/GlowBackground.tsx's current family) and the muted olive
// "Day Streak" label tone — both pixel-sampled directly from the user's own Streak.png mockup
// (Downloads/Streak.png) rather than guessed, so the downloaded card matches the design exactly.
const YELLOW = "#ffff9d";
const MUTED_OLIVE = "#585830";
const PILL_BG = "#252517";

/// Renders the streak card to an offscreen canvas and triggers a PNG download — matches the
/// on-screen preview below pixel-for-pixel (same colors/layout), redesigned per the user's own
/// Streak.png mockup: wordmark up top, a "Best Xd – Y% Completion" pill, the giant streak number,
/// a muted "Day Streak" label, and the column illustration bleeding off the bottom edge.
function downloadStreakCard(params: {
  currentStreak: number;
  longestStreak: number;
  completionRateBps: number;
  wordmark: HTMLImageElement | null;
  column: HTMLImageElement | null;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_SIZE;
  canvas.height = CARD_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#0e0e0b";
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);

  ctx.textAlign = "center";

  if (params.wordmark) {
    const w = 260;
    const h = (w / params.wordmark.width) * params.wordmark.height;
    ctx.drawImage(params.wordmark, (CARD_SIZE - w) / 2, 90, w, h);
  }

  const pillText = `Best ${params.longestStreak}d – ${(params.completionRateBps / 100).toFixed(0)}% Completion`;
  ctx.font = "500 28px system-ui, sans-serif";
  const pillTextWidth = ctx.measureText(pillText).width;
  const pillPaddingX = 32;
  const pillWidth = pillTextWidth + pillPaddingX * 2;
  const pillHeight = 64;
  const pillX = (CARD_SIZE - pillWidth) / 2;
  const pillY = 290;
  ctx.fillStyle = PILL_BG;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();
  ctx.fillStyle = YELLOW;
  ctx.fillText(pillText, CARD_SIZE / 2, pillY + pillHeight / 2 + 10);

  ctx.font = "700 300px system-ui, sans-serif";
  ctx.fillStyle = YELLOW;
  ctx.fillText(String(params.currentStreak), CARD_SIZE / 2, 640);

  ctx.font = "400 56px Rakkas, serif";
  ctx.fillStyle = MUTED_OLIVE;
  ctx.fillText("Day Streak", CARD_SIZE / 2, 730);

  if (params.column) {
    const w = 560;
    const h = (w / params.column.width) * params.column.height;
    ctx.drawImage(params.column, (CARD_SIZE - w) / 2, CARD_SIZE - h + 40, w, h);
  }

  const link = document.createElement("a");
  link.download = "argus-streak.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function StreakPanel({ displayName }: { displayName: string }) {
  const { currentStreak, longestStreak, completionRateBps } = useStreak();

  const hasData = currentStreak !== undefined;

  async function handleDownload() {
    const [wordmark, column] = await Promise.all([
      loadImage("/argus-wordmark-yellow.png").catch(() => null),
      loadImage("/streak-column.png").catch(() => null),
    ]);
    downloadStreakCard({
      currentStreak: currentStreak ?? 0,
      longestStreak: longestStreak ?? 0,
      completionRateBps: completionRateBps ?? 0,
      wordmark,
      column,
    });
  }

  return (
    // One visual card matching downloadStreakCard's own art direction (dark surface, centered
    // wordmark/pill/number/label stack, column bleeding off the bottom) so the on-screen preview
    // and the actual downloaded PNG read as the same object — redesigned per the user's own
    // Streak.png mockup (Downloads/Streak.png), replacing the old plain black/white/grey layout.
    <div className="group relative overflow-hidden rounded-2xl bg-card pb-0 pt-10 text-center">
      <Image
        src="/argus-wordmark-yellow.png"
        alt="Argus"
        width={894}
        height={313}
        className="mx-auto h-8 w-auto"
      />

      <div
        className="mx-6 mt-8 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium"
        style={{ backgroundColor: PILL_BG, color: YELLOW }}
      >
        {hasData
          ? `Best ${longestStreak}d – ${(completionRateBps! / 100).toFixed(0)}% Completion`
          : "—"}
      </div>

      <p className="mt-6 text-7xl font-bold tabular-nums" style={{ color: YELLOW }}>
        {hasData ? currentStreak : "—"}
      </p>
      <p className="font-display mt-2 text-2xl" style={{ color: MUTED_OLIVE }}>
        Day Streak
      </p>
      {displayName && <p className="mt-4 text-xs text-white/40">{displayName}</p>}

      {/* Column illustration bleeds past the card's own bottom edge (per the mockup) — the card's
          overflow-hidden clips it there rather than needing a hard-coded height. */}
      <div className="pointer-events-none mt-6 flex justify-center">
        <Image
          src="/streak-column.png"
          alt=""
          width={444}
          height={310}
          className="w-2/3 max-w-[280px]"
        />
      </div>

      <button
        onClick={handleDownload}
        disabled={!hasData}
        aria-label="Download shareable card"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-[opacity,transform] duration-150 ease-emil-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
      >
        <DownloadSimple size={16} weight="bold" />
      </button>
    </div>
  );
}
