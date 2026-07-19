"use client";

import { useState } from "react";
import Image from "next/image";
import { ConnectButton } from "./ConnectButton";
import { GlowBackground } from "./GlowBackground";
import { DotGrid } from "./DotGrid";
import { WelcomeModal } from "./WelcomeModal";

/// One-fold, no-scroll landing screen shown before a wallet is connected/signed-in — `h-dvh`
/// (not `100vh`, avoids the mobile browser-chrome resize jump) with three stacked sections: a
/// top bar (wordmark + a "How it works" link), a centered hero, and a small footer. Carries the
/// same GlowBackground/DotGrid pairing the dashboard card uses (intensity 0.5, so the very first
/// screen a visitor sees isn't the one plain exception in an otherwise-textured app) — lower than
/// the dashboard's 1 baseline since this hero is a simpler, more text-focused surface. "use
/// client" added for the "How it works" link's local open/close state (this file was previously
/// server-renderable — everything else here is static markup with no interactivity of its own,
/// `ConnectButton` already carries its own "use client").
export function LandingScreen({ onSignedIn }: { onSignedIn: (wallet: string) => void }) {
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden px-4">
      <GlowBackground intensity={0.5} />
      <DotGrid intensity={0.5} />

      <header className="relative z-10 flex items-center justify-between py-6">
        {/* Real brand wordmark (icon + "Argus" lockup) — replaces the old Phosphor Eye + Rakkas
            text placeholder now that an actual asset exists. Intrinsic 894×313 (public/argus-
            wordmark.png) with the render height pinned via className so next/image can still
            derive the correct aspect ratio. */}
        <Image src="/argus-wordmark.png" alt="Argus" width={894} height={313} priority className="h-8 w-auto" />

        {/* Plain muted text link, not a filled pill — stays clearly secondary to the one real CTA
            (Connect Wallet) in the hero below. Opens the same four-step WelcomeModal shown
            post-signin, reused rather than duplicating that copy. */}
        <button
          onClick={() => setHowItWorksOpen(true)}
          className="text-sm text-muted transition-transform duration-150 ease-emil-out hover:text-foreground active:scale-[0.97]"
        >
          How it works
        </button>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <span className="rounded-full bg-surface px-4 py-1.5 text-xs font-medium text-muted">
          Non-custodial · Built on Monad
        </span>

        <div className="max-w-lg space-y-3">
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">
            Commit your money.
            <br />
            Keep your word.
          </h1>
          <p className="text-sm text-muted sm:text-base">
            Argus is a non-custodial accountability wallet — stake funds on your own habits, and
            you decide where a missed day&apos;s money goes.
          </p>
        </div>

        <ConnectButton onSignedIn={onSignedIn} />

        <p className="text-xs text-muted">Non-custodial · Monad testnet</p>
      </main>

      <footer className="relative z-10 py-4 text-center text-xs text-muted">
        © 2026 Argus — Built on Monad testnet.
      </footer>

      <WelcomeModal open={howItWorksOpen} onClose={() => setHowItWorksOpen(false)} />
    </div>
  );
}
