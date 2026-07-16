"use client";

import { useRef, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { PENALTY_TYPES, PENALTY_TYPE_INDEX, PENALTY_TYPE_LABEL, type PenaltyType } from "@/lib/penalty";
import { useCreateHabit } from "@/hooks/useCreateHabit";
import { useUnmirroredHabits } from "@/hooks/useUnmirroredHabits";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { useVaultTransfer } from "@/hooks/useVaultTransfer";
import { HabitDurationPicker } from "./HabitDurationPicker";
import { HabitDeadlineTimePicker } from "./HabitDeadlineTimePicker";
import { WalletReconnect } from "./WalletReconnect";
import { DeployWalletForm } from "./DeployWalletForm";
import { Spinner } from "./Spinner";

// "penalty" (consequence + per-habit stake) now comes before "wallet" (deploy + fund) and
// "habit" moves to last — a habit can only ever be created once a funded vault exists, so
// nobody creates a habit and starts uploading proof with nothing actually at risk. The penalty
// step still has to precede wallet deploy: its asset picker (vaultAsset) fixes the vault's
// deploy-time asset.
const STEPS = ["profile", "penalty", "wallet", "habit", "done"] as const;
type Step = (typeof STEPS)[number];

const contractsDeployed = Boolean(addresses.habitManager && addresses.penaltyEngine && addresses.argusFactory);

export function SetupFlow({ onComplete }: { onComplete: () => void }) {
  const { isConnected } = useAccount();
  const [displayName, setDisplayName] = useState("");
  const [vaultAsset, setVaultAsset] = useState<"mon" | "usdc">("mon");
  const [habitName, setHabitName] = useState("");
  const [targetDays, setTargetDays] = useState<number | null>(null);
  const [deadlineTime, setDeadlineTime] = useState<string | null>(null);
  const [penaltyType, setPenaltyType] = useState<PenaltyType>("savingsVault");
  const [stakeAmount, setStakeAmount] = useState("0.01");
  const [step, setStep] = useState<Step>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { data: _receipt } = useWaitForTransactionReceipt();
  void _receipt;
  const habitCreation = useCreateHabit();

  // Deploy-then-fund sub-flow inside the "wallet" step — see the mandatory-deposit gate below.
  const [walletDeployed, setWalletDeployed] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const {
    walletAddress,
    symbol: vaultSymbol,
    availableFormatted,
    refetchWalletAddress,
    refetchAll: refetchVault,
  } = useAccountabilityWallet();
  const { deposit: doDeposit, busy: depositing, error: depositError } = useVaultTransfer();

  const { data: donationAddressData } = useReadContract({
    address: addresses.penaltyEngine,
    abi: abis.penaltyEngine,
    functionName: "donationAddress",
    chainId: activeChain.id,
    query: { enabled: Boolean(addresses.penaltyEngine) },
  });
  const donationAddress = donationAddressData as `0x${string}` | undefined;

  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) {
      setError(null);
      setStep(STEPS[i - 1]);
    }
  }

  // Shared with the post-setup "+ Add Habit" recovery flow (HabitList.tsx /
  // RecoverHabitsModal.tsx) — see useUnmirroredHabits.ts for why this check exists and why it
  // must never auto-name/auto-continue past an unmirrored on-chain habit.
  const { unmirrored, recheck: recheckUnmirrored } = useUnmirroredHabits();
  const checkingExistingHabits = step === "habit" && unmirrored === null;
  const [recoveredNames, setRecoveredNames] = useState<Record<number, string>>({});
  const [savingRecovered, setSavingRecovered] = useState(false);

  async function saveRecoveredHabits() {
    if (!unmirrored) return;
    setSavingRecovered(true);
    setError(null);
    try {
      for (const h of unmirrored) {
        const name = (recoveredNames[h.contractIndex] ?? "").trim();
        const res = await fetch("/api/habits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractIndex: h.contractIndex, name }),
        });
        if (!res.ok) throw new Error("Failed to save a recovered habit — try again");
      }
      await recheckUnmirrored();
      setStep("done");
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recovered habits");
    } finally {
      setSavingRecovered(false);
    }
  }

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
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) throw new Error("Could not save profile");
      setStep("penalty");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  async function submitHabit() {
    const ok = await habitCreation.createHabit(habitName, targetDays, deadlineTime);
    if (ok) {
      setStep("done");
      onComplete();
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
      const assetSymbol = vaultAsset === "usdc" ? "USDC" : "MON";
      const amountWei = parseUnits(stakeAmount || "0", decimals);

      await writeContractAsync({
        address: addresses.penaltyEngine!,
        abi: abis.penaltyEngine,
        functionName: "configurePenalty",
        args: [PENALTY_TYPE_INDEX[penaltyType], amountWei],
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return;

      const mirrorRes = await fetch("/api/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          penaltyType,
          amountWei: amountWei.toString(),
          assetSymbol,
          assetDecimals: decimals,
        }),
      });
      if (!mirrorRes.ok) throw new Error("Penalty configured on-chain but failed to save — refresh and try again");
      setStep("wallet");
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to configure penalty on-chain");
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }


  const showBack = step !== "profile" && step !== "done";

  const STEP_NUMBER: Record<(typeof STEPS)[number], number> = { profile: 1, penalty: 2, wallet: 3, habit: 4, done: 4 };
  const totalSteps = 4;
  const currentStepNumber = STEP_NUMBER[step];

  return (
    <div className="mx-auto w-full max-w-sm space-y-4">
      {step !== "done" && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted">
            Step {currentStepNumber} of {totalSteps}
          </p>
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${i < currentStepNumber ? "bg-foreground" : "bg-surface"}`}
              />
            ))}
          </div>
        </div>
      )}

      {showBack && (
        <button onClick={back} className="flex items-center gap-1 text-xs text-muted underline">
          <ArrowLeft size={12} weight="bold" />
          Back
        </button>
      )}

      {!contractsDeployed && (
        <p className="rounded-md bg-surface p-3 text-xs text-muted">
          Contracts aren&apos;t deployed yet. Run <code>forge script script/Deploy.s.sol</code> in{" "}
          <code>contracts/</code>, then set the <code>NEXT_PUBLIC_*_ADDRESS</code> env vars. You can still set your
          display name below.
        </p>
      )}

      {step === "profile" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-white/70">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How should Argus greet you?"
            className="w-full rounded-md bg-surface px-3 py-2 text-sm"
          />

          <button
            onClick={saveProfile}
            disabled={busy || !displayName}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
          >
            {busy && <Spinner size={14} />}
            Continue
          </button>
        </div>
      )}

      {step === "habit" && checkingExistingHabits && (
        <p className="text-center text-sm text-muted">Checking for existing habits…</p>
      )}

      {step === "habit" && !checkingExistingHabits && unmirrored && unmirrored.length > 0 && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-white/70">
            We found {unmirrored.length} existing habit{unmirrored.length === 1 ? "" : "s"} on this wallet
          </label>
          <p className="text-xs text-muted">
            This wallet already has active habit slots on-chain from before — name each one to bring it into your
            dashboard.
          </p>
          {unmirrored.map((h) => (
            <input
              key={h.contractIndex}
              value={recoveredNames[h.contractIndex] ?? ""}
              onChange={(e) => setRecoveredNames((prev) => ({ ...prev, [h.contractIndex]: e.target.value }))}
              placeholder={`Name for habit slot ${h.contractIndex + 1}`}
              className="w-full rounded-md bg-surface px-3 py-2 text-sm"
            />
          ))}
          <button
            onClick={saveRecoveredHabits}
            disabled={savingRecovered || unmirrored.some((h) => !(recoveredNames[h.contractIndex] ?? "").trim())}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
          >
            {savingRecovered && <Spinner size={14} />}
            {savingRecovered ? "Saving…" : "Continue"}
          </button>
        </div>
      )}

      {step === "habit" && !checkingExistingHabits && unmirrored && unmirrored.length === 0 && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-white/70">Your first habit</label>
          <input
            value={habitName}
            onChange={(e) => setHabitName(e.target.value)}
            placeholder="e.g. Code, Gym, Read"
            className="w-full rounded-md bg-surface px-3 py-2 text-sm"
          />

          <HabitDurationPicker value={targetDays} onChange={setTargetDays} />
          <HabitDeadlineTimePicker value={deadlineTime} onChange={setDeadlineTime} />

          {isConnected ? (
            <>
              <button
                onClick={submitHabit}
                disabled={habitCreation.busy || !habitName}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
              >
                {habitCreation.busy && <Spinner size={14} />}
                {habitCreation.busy ? "Confirm in wallet…" : "Create habit"}
              </button>
              {habitCreation.busy && (
                <button onClick={habitCreation.cancel} className="w-full text-center text-xs text-muted underline">
                  Stuck? Cancel and try again
                </button>
              )}
              {habitCreation.error && <p className="text-xs text-red-500">{habitCreation.error}</p>}
            </>
          ) : (
            <WalletReconnect />
          )}
        </div>
      )}

      {step === "penalty" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-white/70">If you miss a day</label>
          <div className="grid grid-cols-2 gap-2">
            {PENALTY_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setPenaltyType(type)}
                className={`relative rounded-md px-3 py-2 text-left text-sm transition-transform duration-150 ease-emil-out active:scale-[0.97] ${
                  penaltyType === type ? "bg-foreground text-background" : "bg-surface"
                }`}
              >
                {PENALTY_TYPE_LABEL[type]}
                {type === "savingsVault" && (
                  <span
                    className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[10px] font-normal ${
                      penaltyType === "savingsVault" ? "bg-background/20 opacity-70" : "bg-background text-muted"
                    }`}
                  >
                    Recommended
                  </span>
                )}
                {type === "donate" && donationAddress && (
                  <span
                    className={`mt-1 block w-fit rounded-full px-2 py-0.5 font-mono text-[10px] font-normal ${
                      penaltyType === "donate" ? "bg-background/20 opacity-70" : "bg-background text-muted"
                    }`}
                  >
                    {donationAddress.slice(0, 6)}…{donationAddress.slice(-4)}
                  </span>
                )}
              </button>
            ))}
          </div>
          {penaltyType === "savingsVault" ? (
            <p className="text-xs text-muted">
              A missed day moves your stake into a locked Savings Vault — still yours, released once the lock
              period passes.
            </p>
          ) : (
            <p className="text-xs text-muted">A missed day sends your stake to Argus, immediately.</p>
          )}

          <label className="block text-sm font-medium text-white/70">Amount at stake per habit, per missed day</label>
          <div className="flex gap-2">
            <input
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              inputMode="decimal"
              className="flex-1 rounded-md bg-surface px-3 py-2 text-sm"
            />
            <div className="flex gap-1 rounded-md p-0.5">
              <button
                onClick={() => setVaultAsset("mon")}
                className={`rounded px-3 py-1.5 text-xs transition-transform duration-150 ease-emil-out active:scale-[0.97] ${vaultAsset === "mon" ? "bg-surface text-foreground" : "text-muted"}`}
              >
                MON
              </button>
              <button
                onClick={() => setVaultAsset("usdc")}
                disabled={!addresses.usdc}
                className={`rounded px-3 py-1.5 text-xs transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-40 ${
                  vaultAsset === "usdc" ? "bg-surface text-foreground" : "text-muted"
                }`}
              >
                USDC
              </button>
            </div>
          </div>
          <p className="text-xs text-muted">
            This also decides what your Accountability Wallet holds — {vaultAsset === "usdc" ? "USDC" : "MON"} in
            the next step. This amount is charged <span className="text-foreground">per habit</span> — with up to
            3 active habits, as much as {stakeAmount && !Number.isNaN(Number(stakeAmount)) ? Number(stakeAmount) * 3 : "3×"} {vaultAsset === "usdc" ? "USDC" : "MON"} could be Committed at once if you missed all of them the same day.
            Everything else you deposit stays freely withdrawable.
          </p>
          {(!stakeAmount || Number(stakeAmount) <= 0) && (
            <p className="text-xs text-red-500">
              A stake amount is required — missing a day needs a real consequence.
            </p>
          )}

          {isConnected ? (
            <>
              <button
                onClick={configurePenalty}
                disabled={busy || !stakeAmount || Number.isNaN(Number(stakeAmount)) || Number(stakeAmount) <= 0}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
              >
                {busy && <Spinner size={14} />}
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

      {step === "wallet" && !walletDeployed && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-white/70">Deploy your Accountability Wallet</label>
          <p className="text-xs text-muted">
            This deploys a vault owned entirely by your wallet address. Argus never holds your funds.
          </p>
          <DeployWalletForm
            defaultAsset={vaultAsset}
            onDeployed={() => {
              setWalletDeployed(true);
              refetchWalletAddress();
            }}
          />
        </div>
      )}

      {step === "wallet" && walletDeployed && !walletAddress && (
        <p className="text-center text-sm text-muted">Setting up your vault…</p>
      )}

      {step === "wallet" && walletDeployed && walletAddress && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-white/70">Fund your wallet</label>
          <p className="text-xs text-muted">
            Deposit at least {stakeAmount} {vaultSymbol} — your habit&apos;s stake — before creating a habit, so
            you&apos;re never uploading proof with nothing actually at risk.
          </p>
          <div className="flex gap-2">
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder={`Amount (${vaultSymbol})`}
              inputMode="decimal"
              className="flex-1 rounded-md bg-surface px-3 py-2 text-sm"
            />
            <button
              onClick={async () => {
                if (await doDeposit(depositAmount)) {
                  setDepositAmount("");
                  refetchVault();
                }
              }}
              disabled={depositing || !depositAmount || Number.isNaN(Number(depositAmount))}
              className="flex items-center gap-1.5 rounded-md bg-surface px-3 py-2 text-sm transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
            >
              {depositing && <Spinner size={14} />}
              {depositing ? "Depositing…" : "Deposit"}
            </button>
          </div>
          <p className="text-xs text-muted">
            Available: {Number(availableFormatted).toFixed(4)} {vaultSymbol}
          </p>
          {depositError && <p className="text-xs text-red-500">{depositError}</p>}

          <button
            onClick={() => setStep("habit")}
            disabled={Number(availableFormatted) < Number(stakeAmount)}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {step === "done" && <p className="text-center text-sm text-muted">All set — loading your dashboard…</p>}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
