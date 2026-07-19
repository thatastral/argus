"use client";

import { CheckCircle, Eye, ShieldCheck, Wallet } from "@phosphor-icons/react";
import { Modal } from "./Modal";

const STORAGE_KEY = "argus_welcome_seen";

const STEPS = [
  {
    icon: Eye,
    title: "Habits you actually keep",
    body: "Create habits, then prove you did them with a live photo or an app-generated summary — Gemini verifies it, no manual review.",
  },
  {
    icon: Wallet,
    title: "Your own funds, at real risk",
    body: "You commit a stake per habit from a wallet only you control — Argus never custodies your funds, only what you've explicitly staked is ever governed.",
  },
  {
    icon: ShieldCheck,
    title: "Miss a day, real consequence",
    body: "Miss a habit and your stake either locks in a Savings Vault (still yours, released later) or goes to Argus — your choice, set in Settings.",
  },
  {
    icon: CheckCircle,
    title: "Argus explains it all",
    body: "Chat with Argus anytime for your streak, wallet breakdown, or to create/edit habits and move funds — it always asks you to confirm before anything happens.",
  },
] as const;

/// Purely cosmetic, one-time intro — localStorage rather than a Supabase column (no migration,
/// no cross-device persistence needed for something this low-stakes; resets if the user clears
/// browser data, which is an acceptable trade-off here). Exported (not just used internally)
/// since `app/page.tsx` now owns the open/closed state itself — see the doc comment on
/// `WelcomeModal` below for why.
export function hasSeenWelcome(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function markWelcomeSeen() {
  window.localStorage.setItem(STORAGE_KEY, "1");
}

/// Now a controlled component (`open`/`onClose`, not a self-managed `useState`) so the same
/// four-step content can be driven by two different callers without duplicating it: `app/
/// page.tsx`'s post-signin auto-open (gated on `hasSeenWelcome()`/`markWelcomeSeen()` above, one
/// time only) and `LandingScreen.tsx`'s new pre-auth "How it works" link (an explicit click,
/// re-openable anytime, no localStorage bookkeeping needed on that path).
export function WelcomeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Welcome to Argus" onClose={onClose}>
      <div className="space-y-5">
        <p className="text-sm text-muted">A quick look at how accountability actually works here.</p>
        <div className="space-y-4">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-white/70">
                <Icon size={16} weight="fill" />
              </span>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted">{body}</p>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97]"
        >
          Let&apos;s go
        </button>
      </div>
    </Modal>
  );
}
