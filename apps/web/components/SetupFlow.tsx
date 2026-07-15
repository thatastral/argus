"use client";

import { useEffect, useRef, useState } from "react";
import { parseUnits } from "viem";
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { addresses, abis, NATIVE_ASSET } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { WalletReconnect } from "./WalletReconnect";

const PENALTY_TYPES = ["save", "donate", "partner", "surprise"] as const;
type PenaltyType = (typeof PENALTY_TYPES)[number];
const PENALTY_TYPE_INDEX: Record<PenaltyType, number> = { save: 0, donate: 1, partner: 2, surprise: 3 };

const STEPS = ["profile", "habit", "penalty", "wallet", "done"] as const;
type Step = (typeof STEPS)[number];

const contractsDeployed = Boolean(addresses.habitManager && addresses.penaltyEngine && addresses.argusFactory);

export function SetupFlow({ onComplete }: { onComplete: () => void }) {
  const { address, isConnected } = useAccount();
  const [displayName, setDisplayName] = useState("");
  const [walletMode, setWalletMode] = useState<"easy" | "hard">("easy");
  const [vaultAsset, setVaultAsset] = useState<"mon" | "usdc">("mon");
  const [habitName, setHabitName] = useState("");
  const [penaltyType, setPenaltyType] = useState<PenaltyType>("save");
  const [partnerAddress, setPartnerAddress] = useState("");
  const [stakeAmount, setStakeAmount] = useState("0.01");
  const [step, setStep] = useState<Step>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { data: _receipt } = useWaitForTransactionReceipt();
  void _receipt;
  const publicClient = usePublicClient({ chainId: activeChain.id });

  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) {
      setError(null);
      setStep(STEPS[i - 1]);
    }
  }

  const [checkingExistingHabits, setCheckingExistingHabits] = useState(false);

  // A habit can exist on-chain (createHabit succeeded) without ever making it into Supabase
  // (the mirror POST failing — e.g. a stale session). Retrying "Create habit" in that state
  // doesn't retry the save, it calls createHabit() again and silently creates a second
  // on-chain habit slot — HabitManager has no dedupe. Before ever offering to create a habit,
  // check whether one already exists on-chain and sync it instead. Habit names live in
  // Supabase only (not on-chain), so a slot with no mirrored name gets a placeholder.
  useEffect(() => {
    if (step !== "habit" || !contractsDeployed || !address || !publicClient) return;
    let cancelled = false;

    (async () => {
      setCheckingExistingHabits(true);
      try {
        const count = (await publicClient.readContract({
          address: addresses.habitManager!,
          abi: abis.habitManager,
          functionName: "habitCount",
          args: [address],
        })) as bigint;

        if (count === 0n) return;

        const existingRes = await fetch("/api/habits");
        const existing: { contract_index: number }[] = existingRes.ok ? (await existingRes.json()).habits : [];
        const mirroredIndexes = new Set(existing.map((h) => h.contract_index));

        for (let i = 0; i < Number(count); i++) {
          if (mirroredIndexes.has(i)) continue;

          const active = (await publicClient.readContract({
            address: addresses.habitManager!,
            abi: abis.habitManager,
            functionName: "habitActive",
            args: [address, BigInt(i)],
          })) as boolean;

          if (!active) continue;

          await fetch("/api/habits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contractIndex: i, name: `Habit ${i + 1}` }),
          });
        }

        if (!cancelled) setStep("penalty");
      } catch {
        // If the sync check itself fails, fall through to the normal create-habit form —
        // worst case the user re-attempts and hits the same error, not a worse one.
      } finally {
        if (!cancelled) setCheckingExistingHabits(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, address, publicClient]);

  // Wallet requests (e.g. wallet_switchEthereumChain, eth_sendTransaction) have no
  // AbortController — a request that never gets a wallet response (extension conflicts,
  // a popup opening off-screen, etc.) leaves the UI stuck on "Confirm in wallet…" forever
  // with no way out. This lets the user give up locally and try again; if the original
  // wallet request eventually does resolve, cancelledRef stops it from acting on stale state.
  const cancelledRef = useRef(false);

  function cancel() {
    cancelledRef.current = true;
    setBusy(false);
    setError("Cancelled — check your wallet extension for a stuck request, then try again.");
  }

  async function saveProfile() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, walletMode }),
      });
      if (!res.ok) throw new Error("Could not save profile");
      setStep("habit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  async function createHabit() {
    if (!contractsDeployed) {
      setError("Contracts not deployed yet — see contracts/README.md, then set NEXT_PUBLIC_*_ADDRESS in .env.local");
      return;
    }
    if (!publicClient || !address) return;
    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    try {
      // createHabit() always appends, so the new habit's index is whatever the count was
      // right before this call — read it fresh rather than assuming this is always index 0.
      const indexBefore = (await publicClient.readContract({
        address: addresses.habitManager!,
        abi: abis.habitManager,
        functionName: "habitCount",
        args: [address],
      })) as bigint;

      const hash = await writeContractAsync({
        address: addresses.habitManager!,
        abi: abis.habitManager,
        functionName: "createHabit",
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return;
      const mirrorRes = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIndex: Number(indexBefore), name: habitName }),
      });
      if (!mirrorRes.ok) throw new Error("Habit created on-chain but failed to save — refresh and try again");
      console.log("createHabit tx", hash);
      setStep("penalty");
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to create habit on-chain");
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  async function configurePenalty() {
    if (!contractsDeployed) {
      setError("Contracts not deployed yet");
      return;
    }
    if (vaultAsset === "usdc" && !addresses.usdc) {
      setError("NEXT_PUBLIC_USDC_ADDRESS is not configured");
      return;
    }
    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    try {
      const decimals = vaultAsset === "usdc" ? 6 : 18;
      const amountWei = parseUnits(stakeAmount || "0", decimals);
      const partner = penaltyType === "partner" ? (partnerAddress as `0x${string}`) : "0x0000000000000000000000000000000000000000";

      await writeContractAsync({
        address: addresses.penaltyEngine!,
        abi: abis.penaltyEngine,
        functionName: "configurePenalty",
        args: [PENALTY_TYPE_INDEX[penaltyType], partner, amountWei],
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return;

      const mirrorRes = await fetch("/api/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          penaltyType,
          partnerAddress: penaltyType === "partner" ? partnerAddress : undefined,
          amountWei: amountWei.toString(),
        }),
      });
      if (!mirrorRes.ok) throw new Error("Penalty configured on-chain but failed to save — refresh and try again");
      setStep(walletMode === "hard" ? "done" : "wallet");
      if (walletMode === "hard") onComplete();
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to configure penalty on-chain");
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  async function deployAndDeposit() {
    if (!contractsDeployed || !address) {
      setError("Contracts not deployed yet");
      return;
    }
    if (vaultAsset === "usdc" && !addresses.usdc) {
      setError("NEXT_PUBLIC_USDC_ADDRESS is not configured");
      return;
    }
    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    try {
      const deployHash = await writeContractAsync({
        address: addresses.argusFactory!,
        abi: abis.argusFactory,
        functionName: "deployWallet",
        args: [vaultAsset === "usdc" ? addresses.usdc! : NATIVE_ASSET],
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return;
      console.log("deployWallet tx", deployHash);

      setStep("done");
      onComplete();
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to deploy Accountability Wallet");
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  const showBack = step !== "profile" && step !== "done";

  return (
    <div className="mx-auto w-full max-w-sm space-y-4">
      {showBack && (
        <button onClick={back} className="text-xs text-muted underline">
          ← Back
        </button>
      )}

      {!contractsDeployed && (
        <p className="rounded-md border border-border bg-surface p-3 text-xs text-muted">
          Contracts aren&apos;t deployed yet. Run <code>forge script script/Deploy.s.sol</code> in{" "}
          <code>contracts/</code>, then set the <code>NEXT_PUBLIC_*_ADDRESS</code> env vars. You can still set your
          display name below.
        </p>
      )}

      {step === "profile" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How should Argus greet you?"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />

          <label className="block text-sm font-medium">Wallet mode</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setWalletMode("easy")}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                walletMode === "easy" ? "border-foreground bg-surface" : "border-border"
              }`}
            >
              Easy Mode
              <span className="mt-1 block text-xs font-normal text-muted">
                Argus deploys a vault you own; deposit into it.
              </span>
            </button>
            <button
              onClick={() => setWalletMode("hard")}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                walletMode === "hard" ? "border-foreground bg-surface" : "border-border"
              }`}
            >
              Hard Mode
              <span className="mt-1 block text-xs font-normal text-muted">
                Use your own wallet directly — no deposit needed.
              </span>
            </button>
          </div>
          {walletMode === "hard" && (
            <p className="rounded-md border border-border bg-surface p-3 text-xs text-muted">
              Hard Mode&apos;s spend-blocking enforcement needs the Chrome Extension, which isn&apos;t built in this
              scaffold yet. Your habits and streak will still track fully on-chain — penalties just won&apos;t move
              funds until the extension exists.
            </p>
          )}

          <button
            onClick={saveProfile}
            disabled={busy || !displayName}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {step === "habit" && checkingExistingHabits && (
        <p className="text-center text-sm text-muted">Checking for existing habits…</p>
      )}

      {step === "habit" && !checkingExistingHabits && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Your first habit</label>
          <input
            value={habitName}
            onChange={(e) => setHabitName(e.target.value)}
            placeholder="e.g. Code, Gym, Read"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          {isConnected ? (
            <>
              <button
                onClick={createHabit}
                disabled={busy || !habitName}
                className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {busy ? "Confirm in wallet…" : "Create habit"}
              </button>
              {busy && (
                <button onClick={cancel} className="w-full text-center text-xs text-muted underline">
                  Stuck? Cancel and try again
                </button>
              )}
            </>
          ) : (
            <WalletReconnect />
          )}
        </div>
      )}

      {step === "penalty" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">If you miss a day</label>
          <div className="grid grid-cols-2 gap-2">
            {PENALTY_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setPenaltyType(type)}
                className={`relative rounded-md border px-3 py-2 text-sm capitalize ${
                  penaltyType === type ? "border-foreground bg-surface" : "border-border"
                }`}
              >
                {type}
                {type === "surprise" && (
                  <span className="mt-1 block w-fit rounded-full bg-border px-2 py-0.5 text-[10px] font-normal normal-case text-muted">
                    picks one at random
                  </span>
                )}
              </button>
            ))}
          </div>
          {penaltyType === "partner" && (
            <input
              value={partnerAddress}
              onChange={(e) => setPartnerAddress(e.target.value)}
              placeholder="Partner's wallet address (0x…)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          )}

          <label className="block text-sm font-medium">Amount at stake per missed day</label>
          <div className="flex gap-2">
            <input
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="flex rounded-md border border-border p-0.5">
              <button
                onClick={() => setVaultAsset("mon")}
                className={`rounded px-3 py-1.5 text-xs ${vaultAsset === "mon" ? "bg-surface text-foreground" : "text-muted"}`}
              >
                MON
              </button>
              <button
                onClick={() => setVaultAsset("usdc")}
                disabled={!addresses.usdc}
                className={`rounded px-3 py-1.5 text-xs disabled:opacity-40 ${
                  vaultAsset === "usdc" ? "bg-surface text-foreground" : "text-muted"
                }`}
              >
                USDC
              </button>
            </div>
          </div>
          <p className="text-xs text-muted">
            This also decides what your Accountability Wallet holds — {vaultAsset === "usdc" ? "USDC" : "MON"} in
            the next step.
          </p>

          {isConnected ? (
            <>
              <button
                onClick={configurePenalty}
                disabled={busy || (penaltyType === "partner" && !partnerAddress)}
                className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {busy ? "Confirm in wallet…" : "Continue"}
              </button>
              {busy && (
                <button onClick={cancel} className="w-full text-center text-xs text-muted underline">
                  Stuck? Cancel and try again
                </button>
              )}
            </>
          ) : (
            <WalletReconnect />
          )}
        </div>
      )}

      {step === "wallet" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Deploy your Accountability Wallet</label>
          <p className="text-xs text-muted">
            This deploys a {vaultAsset === "usdc" ? "USDC" : "MON"} vault owned entirely by your wallet address.
            Argus never holds your funds.
          </p>

          {isConnected ? (
            <>
              <button
                onClick={deployAndDeposit}
                disabled={busy}
                className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {busy ? "Confirm in wallet…" : "Deploy wallet"}
              </button>
              {busy && (
                <button onClick={cancel} className="w-full text-center text-xs text-muted underline">
                  Stuck? Cancel and try again
                </button>
              )}
            </>
          ) : (
            <WalletReconnect />
          )}
        </div>
      )}

      {step === "done" && <p className="text-center text-sm text-muted">All set — loading your dashboard…</p>}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
