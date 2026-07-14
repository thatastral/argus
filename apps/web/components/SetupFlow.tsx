"use client";

import { useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";

const PENALTY_TYPES = ["save", "donate", "partner", "surprise"] as const;
type PenaltyType = (typeof PENALTY_TYPES)[number];
const PENALTY_TYPE_INDEX: Record<PenaltyType, number> = { save: 0, donate: 1, partner: 2, surprise: 3 };

const contractsDeployed = Boolean(addresses.habitManager && addresses.penaltyEngine && addresses.argusFactory);

export function SetupFlow({ onComplete }: { onComplete: () => void }) {
  const { address } = useAccount();
  const [displayName, setDisplayName] = useState("");
  const [habitName, setHabitName] = useState("");
  const [penaltyType, setPenaltyType] = useState<PenaltyType>("save");
  const [partnerAddress, setPartnerAddress] = useState("");
  const [amountMon, setAmountMon] = useState("0.01");
  const [step, setStep] = useState<"profile" | "habit" | "penalty" | "wallet" | "done">("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { data: _receipt } = useWaitForTransactionReceipt();
  void _receipt;

  async function saveProfile() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, walletMode: "easy" }),
      });
      setStep("habit");
    } catch {
      setError("Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  async function createHabit() {
    if (!contractsDeployed) {
      setError("Contracts not deployed yet — see contracts/README.md, then set NEXT_PUBLIC_*_ADDRESS in .env.local");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: addresses.habitManager!,
        abi: abis.habitManager,
        functionName: "createHabit",
        args: [habitName],
        chainId: activeChain.id,
      });
      await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIndex: 0, name: habitName }),
      });
      console.log("createHabit tx", hash);
      setStep("penalty");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create habit on-chain");
    } finally {
      setBusy(false);
    }
  }

  async function configurePenalty() {
    if (!contractsDeployed) {
      setError("Contracts not deployed yet");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const amountWei = BigInt(Math.round(Number(amountMon) * 1e18));
      const partner = penaltyType === "partner" ? (partnerAddress as `0x${string}`) : "0x0000000000000000000000000000000000000000";

      await writeContractAsync({
        address: addresses.penaltyEngine!,
        abi: abis.penaltyEngine,
        functionName: "configurePenalty",
        args: [PENALTY_TYPE_INDEX[penaltyType], partner, amountWei],
        chainId: activeChain.id,
      });

      await fetch("/api/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          penaltyType,
          partnerAddress: penaltyType === "partner" ? partnerAddress : undefined,
          amountWei: amountWei.toString(),
        }),
      });
      setStep("wallet");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to configure penalty on-chain");
    } finally {
      setBusy(false);
    }
  }

  async function deployAndDeposit() {
    if (!contractsDeployed || !address) {
      setError("Contracts not deployed yet");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const deployHash = await writeContractAsync({
        address: addresses.argusFactory!,
        abi: abis.argusFactory,
        functionName: "deployWallet",
        chainId: activeChain.id,
      });
      console.log("deployWallet tx", deployHash);

      // Wallet address is only known after the tx confirms and we can read walletOf().
      // For the scaffold we just record that a deploy was attempted; the dashboard's
      // on-chain read of ArgusFactory.walletOf(address) is the source of truth.
      await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      setStep("done");
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deploy Accountability Wallet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-4">
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
          <button
            onClick={saveProfile}
            disabled={busy || !displayName}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {step === "habit" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Your first habit</label>
          <input
            value={habitName}
            onChange={(e) => setHabitName(e.target.value)}
            placeholder="e.g. Code, Gym, Read"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={createHabit}
            disabled={busy || !habitName}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            {busy ? "Confirm in wallet…" : "Create habit"}
          </button>
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
                className={`rounded-md border px-3 py-2 text-sm capitalize ${
                  penaltyType === type ? "border-foreground bg-surface" : "border-border"
                }`}
              >
                {type}
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
          <label className="block text-sm font-medium">Amount at stake per missed day (MON)</label>
          <input
            value={amountMon}
            onChange={(e) => setAmountMon(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={configurePenalty}
            disabled={busy || (penaltyType === "partner" && !partnerAddress)}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            {busy ? "Confirm in wallet…" : "Continue"}
          </button>
        </div>
      )}

      {step === "wallet" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Deploy your Accountability Wallet</label>
          <p className="text-xs text-muted">
            This deploys a vault owned entirely by your wallet address. Argus never holds your funds.
          </p>
          <button
            onClick={deployAndDeposit}
            disabled={busy}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            {busy ? "Confirm in wallet…" : "Deploy wallet"}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
