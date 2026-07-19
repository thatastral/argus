"use client";

import { ArrowClockwise, Eye, Fire, GearSix } from "@phosphor-icons/react";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { useStreak } from "@/hooks/useStreak";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";

/// Page-level chrome: logo/wordmark on the left, streak + balance pills on the right. Stays
/// mounted outside whatever shifts when the chat sidebar opens (see app/page.tsx) — the wrapper
/// there reserves right padding for the sidebar so this row never sits underneath it.
/// Settings isn't part of either reference mock — added here as a small icon since it still
/// needs to be reachable somewhere (display name, penalty changes).
export function AppHeader({
  onOpenWallet,
  onOpenStreak,
  onOpenSettings,
  onRefreshAll,
}: {
  onOpenWallet: () => void;
  onOpenStreak: () => void;
  onOpenSettings: () => void;
  /// The one refresh button for the whole dashboard — refetches this header's own wallet/streak
  /// reads directly, plus calls up to app/page.tsx for /api/state and the habit list's data
  /// (both live in sibling components with their own internal fetching, so page.tsx is the only
  /// place that can reach all of it from one click).
  onRefreshAll: () => void;
}) {
  const {
    walletAddress,
    balanceFormatted,
    symbol,
    availableFormatted,
    committedFormatted,
    savingsVaultFormatted,
    savingsVaultLocked,
    balancesLoading,
    refetchAll: refetchWallet,
  } = useAccountabilityWallet();
  const { currentStreak, refetchAll: refetchStreak } = useStreak();

  const balancePillLabel = !walletAddress
    ? "Set up wallet"
    : balancesLoading
      ? "…"
      : `${Number(balanceFormatted).toFixed(2)} ${symbol}`;

  return (
    <header className="flex items-center justify-between gap-2 px-4 py-5 sm:px-8">
      <div className="flex items-center gap-1.5">
        <Eye size={23} weight="fill" />
        <span className="font-display text-2xl tracking-wide">Argus</span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        <button
          onClick={() => {
            refetchWallet();
            refetchStreak();
            onRefreshAll();
          }}
          aria-label="Refresh everything"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted hover:text-foreground ${PRESS_FEEDBACK}`}
        >
          <ArrowClockwise size={16} weight="bold" />
        </button>

        <button
          onClick={onOpenStreak}
          className={`flex shrink-0 items-center gap-2 rounded-full bg-surface py-2 pl-2 pr-4 text-sm font-medium ${PRESS_FEEDBACK}`}
        >
          {/* Colored only once there's an actual streak to show off — a 0-day streak badged the
              same as a 12-day one would read as a false achievement. */}
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              currentStreak && currentStreak > 0 ? "bg-flame/15 text-flame" : "text-muted"
            }`}
          >
            <Fire size={16} weight="fill" />
          </span>
          {currentStreak ?? "—"}
        </button>

        <div className="group relative">
          <button
            onClick={onOpenWallet}
            className={`max-w-[7rem] truncate rounded-full bg-surface px-5 py-3 text-sm font-medium sm:max-w-none ${PRESS_FEEDBACK}`}
          >
            {balancePillLabel}
          </button>

          {/* Hover breakdown — the compact pill only ever shows the total, this is the detail
              view: the vault address plus the Available/Committed split (never a wallet-wide
              lock anymore — only Committed and, while locked, the Savings Vault are ever
              unwithdrawable). Gated behind @media(hover:hover) — touch has no hover state, and
              the same pill's onClick already opens the full Wallet modal breakdown, so nothing
              is lost by not showing this popover on a phone. */}
          <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-56 rounded-xl bg-card p-3 opacity-0 shadow-lg transition-opacity [@media(hover:hover)]:group-hover:opacity-100">
            {walletAddress ? (
              <div className="space-y-2">
                <p className="text-xs text-muted">Accountability Wallet</p>
                <p className="font-mono text-xs text-muted">{truncateAddress(walletAddress)}</p>
                {balancesLoading ? (
                  <p className="text-xs text-muted">Loading…</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Available</span>
                      <span>
                        {Number(availableFormatted).toFixed(2)} {symbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Committed</span>
                      <span>
                        {Number(committedFormatted).toFixed(2)} {symbol}
                      </span>
                    </div>
                    {/* Always shown, even at $0 — so the mechanic is discoverable before a user
                        ever misses a day, not just after (see WalletStatus.tsx for the same). */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Savings Vault</span>
                      <span>{savingsVaultLocked ? `${Number(savingsVaultFormatted).toFixed(2)} ${symbol}` : "Not locked"}</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted">No vault deployed yet — click to set one up.</p>
            )}
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          aria-label="Settings"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface ${PRESS_FEEDBACK}`}
        >
          <GearSix size={18} weight="fill" />
        </button>
      </div>
    </header>
  );
}
