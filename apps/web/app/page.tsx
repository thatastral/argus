"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { SetupFlow } from "@/components/SetupFlow";
import { HabitList } from "@/components/HabitList";
import { WalletStatus } from "@/components/WalletStatus";
import { ChatHero } from "@/components/ChatHero";
import { BottomSheet } from "@/components/BottomSheet";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";

interface StateResponse {
  wallet: string;
  user: { display_name: string; wallet_mode: string } | null;
  habits: { contract_index: number; name: string; active: boolean }[];
  streak: { current_streak: number; longest_streak: number; completion_rate_bps: number } | null;
  todaysCompletions: { contract_index: number; verified: boolean }[];
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
  const [openSheet, setOpenSheet] = useState<"habits" | "wallet" | null>(null);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/state");
    if (res.ok) setState(await res.json());
  }, []);

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
        if (!cancelled && data) setState(data);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionWallet]);

  const { balanceFormatted, symbol, isUnlocked } = useAccountabilityWallet();

  if (sessionWallet === undefined) {
    return null;
  }

  if (!sessionWallet) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Argus</h1>
          <p className="mt-1 text-sm text-muted">Your AI-powered accountability wallet on Monad.</p>
        </div>
        <ConnectButton onSignedIn={setSessionWallet} />
      </main>
    );
  }

  if (!state || state.habits.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
        <h1 className="text-xl font-semibold">Let&apos;s set up Argus</h1>
        <SetupFlow onComplete={loadState} />
      </main>
    );
  }

  const completedIndexes = state.todaysCompletions.filter((c) => c.verified).map((c) => c.contract_index);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-10 px-4 py-12">
      <div className="text-center">
        <p className="text-6xl font-semibold tabular-nums">
          {Number(balanceFormatted).toFixed(2)} <span className="text-3xl text-muted">{symbol}</span>
        </p>
        <p className="mt-2 font-mono text-xs uppercase tracking-wide text-muted">
          {isUnlocked ? "unlocked" : "locked"}
          {state.streak && ` · streak ${state.streak.current_streak}d`}
        </p>
      </div>

      <div className="text-center">
        <h1 className="text-xl font-medium">
          {timeGreeting()}
          {state.user?.display_name ? `, ${state.user.display_name}` : ""}
        </h1>
        {state.streak && (
          <p className="mt-1 font-mono text-xs uppercase tracking-wide text-muted">
            best streak {state.streak.longest_streak}d · {(state.streak.completion_rate_bps / 100).toFixed(0)}%
            completion
          </p>
        )}
      </div>

      <ChatHero />

      <div className="flex gap-2">
        <button
          onClick={() => setOpenSheet("habits")}
          className="rounded-full border border-border px-4 py-1.5 text-xs uppercase tracking-wide text-muted hover:text-foreground"
        >
          Habits
        </button>
        <button
          onClick={() => setOpenSheet("wallet")}
          className="rounded-full border border-border px-4 py-1.5 text-xs uppercase tracking-wide text-muted hover:text-foreground"
        >
          Wallet
        </button>
      </div>

      <BottomSheet open={openSheet === "habits"} title="Today's habits" onClose={() => setOpenSheet(null)}>
        <HabitList habits={state.habits} completedIndexes={completedIndexes} onVerified={loadState} />
      </BottomSheet>

      <BottomSheet open={openSheet === "wallet"} title="Wallet" onClose={() => setOpenSheet(null)}>
        <WalletStatus />
      </BottomSheet>
    </main>
  );
}
