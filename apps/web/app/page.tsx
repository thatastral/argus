"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { SetupFlow } from "@/components/SetupFlow";
import { HabitList } from "@/components/HabitList";
import { WalletStatus } from "@/components/WalletStatus";
import { ChatPanel } from "@/components/ChatPanel";

interface StateResponse {
  wallet: string;
  user: { display_name: string; wallet_mode: string } | null;
  habits: { contract_index: number; name: string; active: boolean }[];
  streak: { current_streak: number; longest_streak: number; completion_rate_bps: number } | null;
  todaysCompletions: { contract_index: number; verified: boolean }[];
}

export default function Home() {
  const [sessionWallet, setSessionWallet] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<StateResponse | null>(null);

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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 md:flex-row">
      <section className="flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-semibold">
            {state.user?.display_name ? `Welcome back, ${state.user.display_name}` : "Welcome back"}
          </h1>
          {state.streak && (
            <p className="text-sm text-muted">
              🔥 {state.streak.current_streak} day streak · best {state.streak.longest_streak} ·{" "}
              {(state.streak.completion_rate_bps / 100).toFixed(0)}% completion
            </p>
          )}
        </div>

        <WalletStatus />

        <div>
          <h2 className="mb-2 text-sm font-medium text-muted">Today&apos;s habits</h2>
          <HabitList habits={state.habits} completedIndexes={completedIndexes} onVerified={loadState} />
        </div>
      </section>

      <section className="h-[32rem] w-full md:w-96">
        <ChatPanel />
      </section>
    </main>
  );
}
