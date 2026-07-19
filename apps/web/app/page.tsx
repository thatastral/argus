"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { Clock, ListChecks, LockSimple } from "@phosphor-icons/react";
import { LandingScreen } from "@/components/LandingScreen";
import { SetupFlow } from "@/components/SetupFlow";
import { HabitList } from "@/components/HabitList";
import { WalletStatus } from "@/components/WalletStatus";
import { AppHeader } from "@/components/AppHeader";
import { ChatSidebar } from "@/components/ChatSidebar";
import { Modal } from "@/components/Modal";
import { SettingsSheet } from "@/components/SettingsSheet";
import { StreakPanel } from "@/components/StreakPanel";
import { WelcomeModal, hasSeenWelcome, markWelcomeSeen } from "@/components/WelcomeModal";
import { InsightCard } from "@/components/InsightCard";
import { GlowBackground } from "@/components/GlowBackground";
import { DotGrid } from "@/components/DotGrid";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { useStreak } from "@/hooks/useStreak";
import { useCountdownToMidnight } from "@/hooks/useCountdownToMidnight";
import { computeCountdown } from "@/hooks/useCountdownToDeadline";
import { computeInsight } from "@/lib/insight";
import type { PenaltyType } from "@/lib/penalty";

interface StateResponse {
  wallet: string;
  user: { display_name: string } | null;
  habits: { contract_index: number; name: string; active: boolean; deadline_time: string | null }[];
  streak: { current_streak: number; longest_streak: number; completion_rate_bps: number } | null;
  penalty: {
    penalty_type: PenaltyType;
    amount_wei: string;
    asset_symbol: string | null;
    asset_decimals: number | null;
  } | null;
  todaysCompletions: { contract_index: number; verified: boolean }[];
  recentCompletionTimestamps: string[];
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const [sessionWallet, setSessionWallet] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<StateResponse | null>(null);
  // Separate from `state` itself — `state === null` means either "still loading" or "genuinely
  // no habits yet," and conflating those flashed "Let's set up Argus" at every returning user on
  // every reload until /api/state resolved. Only the true genuinely-empty case should fall into
  // SetupFlow below.
  const [stateLoaded, setStateLoaded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [overlay, setOverlay] = useState<"wallet" | "streak" | "settings" | null>(null);
  // WelcomeModal is now a controlled component (see its doc comment) — this is the post-signin
  // auto-open path, gated on the same one-time localStorage flag it always used; LandingScreen's
  // "How it works" link drives its own independent instance of the same component.
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome());
  const { address: connectedAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { currentStreak, refetchAll: refetchStreak } = useStreak();
  // Called unconditionally here (before the early-return guards below) so the stat row's "time
  // left" pill can reuse it — same live countdown HabitDayGroups.tsx's TodayStatusPill already
  // shows, just a second consumer of the same hook, not a new computation.
  const timeLeft = useCountdownToMidnight();
  // Same reasoning: the stat row's "committed" pill used to be derived client-side from the
  // already-fetched Supabase penalty config (stake × active habit count) — a real, reported
  // mismatch against the Wallet modal (WalletStatus.tsx), which reads the actual live
  // committedAmount() on-chain and, since completing a habit now excludes it from that figure
  // immediately (see AccountabilityWallet.sol), goes stale the moment a habit is completed. This
  // is the same hook WalletStatus.tsx already uses, so both surfaces now read the identical live
  // value — not a second, independently-drifting computation.
  const { committedFormatted, symbol: committedSymbol, balancesLoading: committedLoading } = useAccountabilityWallet();

  const loadState = useCallback(async () => {
    const res = await fetch("/api/state");
    if (res.ok) setState(await res.json());
    refetchStreak();
  }, [refetchStreak]);

  // Single nav-bar refresh button (AppHeader) drives everything from here — bumping this token
  // is how HabitList's own habit/history fetch re-triggers, since it lives in a sibling
  // component with its own internal data fetching, not state lifted to this page.
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshAll = useCallback(() => {
    loadState();
    setRefreshToken((t) => t + 1);
  }, [loadState]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setSessionWallet(data.wallet));
  }, []);

  useEffect(() => {
    if (!sessionWallet) return;
    let cancelled = false;
    fetch("/api/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setState(data);
        setStateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionWallet]);

  // The session cookie only ever changes on an explicit sign-in/sign-out through ConnectButton —
  // nothing previously reacted to the wallet extension's own account switcher, so switching
  // accounts there (without disconnecting in-app first) left the dashboard silently showing the
  // *previous* wallet's habits/data forever, since `sessionWallet` never updated to match.
  // Confirmed-plausible live cause of "when a new wallet is connected, old habits [from the
  // stale session] keep showing." This only drops our own session tracking — it deliberately
  // never calls wagmi's disconnect(), since the user's wallet is still connected, just to a
  // different address; dropping sessionWallet lands them on LandingScreen, whose ConnectButton
  // already shows `isConnected` true and jumps straight to the sign-in step for the new address.
  useEffect(() => {
    if (!sessionWallet || !isConnected || !connectedAddress) return;
    if (connectedAddress.toLowerCase() === sessionWallet.toLowerCase()) return;
    fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      setState(null);
      setStateLoaded(false);
      setChatOpen(false);
      setOverlay(null);
      setSessionWallet(null);
    });
  }, [connectedAddress, isConnected, sessionWallet]);

  // Full sign-out: clears the session cookie and disconnects the wallet connector so a
  // different address can connect + go through SetupFlow as a genuinely new user, rather than
  // just closing the tab (which leaves both the cookie and the wallet connection live).
  async function signOut() {
    disconnect();
    await fetch("/api/auth/logout", { method: "POST" });
    setState(null);
    setStateLoaded(false);
    setChatOpen(false);
    setOverlay(null);
    setSessionWallet(null);
  }

  if (sessionWallet === undefined) {
    return null;
  }

  if (!sessionWallet) {
    return <LandingScreen onSignedIn={setSessionWallet} />;
  }

  if (!stateLoaded) {
    return null;
  }

  if (!state || state.habits.length === 0) {
    return (
      <main className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden px-4 py-12">
        {/* SetupFlow itself cycles through every onboarding step (profile/penalty/wallet/habit)
            inside this same persistent <main>, so mounting the background here once covers all
            of them without touching SetupFlow.tsx. */}
        <GlowBackground intensity={0.75} />
        <DotGrid intensity={0.75} />
        <h1 className="relative z-10 text-xl font-semibold">Let&apos;s set up Argus</h1>
        <div className="relative z-10 w-full">
          <SetupFlow onComplete={loadState} onBackToLanding={signOut} />
        </div>
      </main>
    );
  }

  const activeHabits = state.habits.filter((h) => h.active);
  const activeHabitCount = activeHabits.length;
  const verifiedToday = new Set(
    state.todaysCompletions.filter((c) => c.verified).map((c) => c.contract_index),
  );
  const remainingToday = activeHabits.filter((h) => !verifiedToday.has(h.contract_index)).length;
  const allDoneToday = remainingToday === 0 && activeHabitCount > 0;
  // Mirrors HabitDayGroups.tsx's day-level resolution: once every active habit is either
  // verified or its own deadline has passed, today is "resolved" (one way or the other) — a
  // habit with no deadline set can only ever resolve via verified, so it keeps today unresolved
  // regardless of the others until real midnight.
  const allResolvedToday =
    activeHabitCount > 0 &&
    activeHabits.every((h) => {
      const deadlineTime = h.deadline_time ? h.deadline_time.slice(0, 5) : null;
      return verifiedToday.has(h.contract_index) || (deadlineTime !== null && computeCountdown(deadlineTime).passed);
    });
  const anyMissedToday = allResolvedToday && !allDoneToday;
  const closeOverlay = () => setOverlay(null);

  const insightMessage = computeInsight(state.recentCompletionTimestamps);

  return (
    <div
      className={`flex min-h-screen flex-col transition-[padding-right] duration-300 ease-emil-out ${
        chatOpen ? "sm:pr-[530px]" : "sm:pr-0"
      }`}
    >
      <AppHeader
        onOpenWallet={() => setOverlay("wallet")}
        onOpenStreak={() => setOverlay("streak")}
        onOpenSettings={() => setOverlay("settings")}
        onRefreshAll={refreshAll}
      />

      <main className="flex flex-1 px-4 pb-4 sm:px-8 sm:pb-8">
        <div className="relative flex w-full flex-1 flex-col overflow-hidden rounded-3xl bg-card p-8 sm:p-12">
          <GlowBackground />
          {/* Intensity pulled down hard per a direct instruction ("reduce the dots opacity
              greatly") — this card is the most content-dense, text-heavy surface in the app, so
              the dot grid needs to stay well in the background rather than competing with the
              habit list. */}
          <DotGrid intensity={0.2} />

          {/* Centered as its own column — reserving the chat panel's width as page padding above
              (only at sm:+, since the panel is full-width below that — see ChatSidebar.tsx) is
              what shifts everything left together when chat opens, matching the reference design
              without separate layout logic here. */}
          <div className="relative z-10 mx-auto w-full max-w-2xl space-y-6">
            <h1 className="text-xl font-light text-white/70">
              Welcome, {state.user?.display_name || "there"}
            </h1>
            <p className="text-2xl font-medium leading-snug text-white/45">
              {timeGreeting()}!{" "}
              {allDoneToday ? (
                <>
                  You&apos;ve completed all <span className="text-white">{activeHabitCount} habits</span> for today
                </>
              ) : anyMissedToday ? (
                <>
                  You missed{" "}
                  <span className="text-white">
                    {remainingToday} {remainingToday === 1 ? "habit" : "habits"}
                  </span>{" "}
                  today
                </>
              ) : (
                <>
                  You have{" "}
                  <span className="text-white">
                    {remainingToday} {remainingToday === 1 ? "Habit" : "Habits"}
                  </span>{" "}
                  to complete today
                </>
              )}
              {currentStreak !== undefined && currentStreak > 0 && (
                <> and you&apos;re on a <span className="text-white">{currentStreak}-day streak</span></>
              )}
              .{" "}
              {allDoneToday
                ? "Great work today — see you tomorrow!"
                : anyMissedToday
                  ? "There's always tomorrow — let's get back on track."
                  : "Finish up today. You've got this!"}
            </p>

            {/* Compact scannable version of the sentence above, not a replacement for it — the
                sentence carries the all-done/missed/streak narrative a bare stat row can't. */}
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium">
                <ListChecks size={14} weight="bold" className="text-muted" />
                {remainingToday} left
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium">
                <LockSimple size={14} weight="bold" className="text-warning" />
                {committedLoading ? "…" : `${Number(committedFormatted).toFixed(2)} ${committedSymbol} committed`}
              </span>
              {!allResolvedToday && (
                <span className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium">
                  <Clock size={14} weight="bold" className="text-muted" />
                  {timeLeft} left
                </span>
              )}
            </div>

            <InsightCard message={insightMessage} />

            <button
              onClick={() => setChatOpen(true)}
              className="group relative overflow-hidden rounded-full bg-surface px-6 py-4 text-sm font-medium transition-transform duration-150 ease-emil-out active:scale-[0.97]"
            >
              {/* Blurred, rotating conic-gradient glow — clipped to the button's own rounded-full
                  shape via the button's own `overflow-hidden`, so it reads as an internal shimmer
                  confined to the pill rather than a halo bleeding onto the page around it. Same
                  gold family as GlowBackground.tsx (kept in sync deliberately, see its doc
                  comment) — first color repeated at the end for a seamless rotation loop. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-4 opacity-0 blur-lg transition-opacity duration-300 ease-emil-out [@media(hover:hover)]:group-hover:animate-glow-spin [@media(hover:hover)]:group-hover:opacity-60"
                style={{
                  background:
                    "conic-gradient(from 0deg, #fde9be, #f5b94c, #e0a233, #c08a2e, #7a5518, #fde9be)",
                }}
              />
              <span className="relative z-10">Chat with Argus</span>
            </button>
          </div>

          <div className="relative z-10 mx-auto mt-8 w-full max-w-2xl">
            <HabitList onChange={loadState} refreshToken={refreshToken} />
          </div>
        </div>
      </main>

      <ChatSidebar open={chatOpen} onClose={() => setChatOpen(false)} />

      <WelcomeModal
        open={welcomeOpen}
        onClose={() => {
          markWelcomeSeen();
          setWelcomeOpen(false);
        }}
      />

      <Modal open={overlay === "settings"} title="Settings" onClose={closeOverlay}>
        <SettingsSheet
          displayName={state.user?.display_name ?? ""}
          currentPenalty={state.penalty}
          onSaved={() => {
            loadState();
            closeOverlay();
          }}
        />
      </Modal>

      <Modal open={overlay === "wallet"} title="Wallet" onClose={closeOverlay}>
        <WalletStatus onSignOut={signOut} configuredAssetSymbol={state.penalty?.asset_symbol ?? null} />
      </Modal>

      <Modal open={overlay === "streak"} title="Discipline streak" onClose={closeOverlay}>
        <StreakPanel displayName={state.user?.display_name ?? ""} />
      </Modal>
    </div>
  );
}
