"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
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
import { WelcomeModal } from "./WelcomeModal";
import { friendlyErrorMessage } from "@/lib/formatError";

// "setup" (consequence + per-habit stake + deploy + fund, all one screen) then "habit" — a habit
// can only ever be created once a funded vault exists, so nobody creates a habit and starts
// uploading proof with nothing actually at risk. Was two separate steps ("penalty" then
// "wallet") until they were merged into one continuous screen, per a direct instruction to cut
// onboarding friction — same underlying on-chain actions (configurePenalty, then deployWallet),
// just no page-transition between them and no re-typing the amount. See DeployWalletForm.tsx for
// the other half of that friction fix: deploy + first deposit now fold into one signature
// (ArgusFactory.deployWallet's own initialDeposit param) instead of two.
const STEPS = ["profile", "setup", "habit", "done"] as const;
type Step = (typeof STEPS)[number];

const contractsDeployed = Boolean(addresses.habitManager && addresses.penaltyEngine && addresses.argusFactory);

export function SetupFlow({
  onComplete,
  onBackToLanding,
}: {
  onComplete: () => void;
  // Only ever wired to the "profile" step's Back button (see showBack below) — every other
  // step's Back stays internal step-navigation via back(). Signing out and disconnecting mid-way
  // through wallet-deploy/habit-creation would abandon an in-progress on-chain step with no
  // clean way back in, so this is deliberately only offered on the one step that has nothing to
  // lose yet.
  onBackToLanding: () => void;
}) {
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
  // Same "How it works" walkthrough LandingScreen.tsx's header link opens — persistent across
  // every onboarding step (not just pre-auth), reusing the identical four-step content rather
  // than duplicating it, per a direct instruction that it should stay reachable through setup too.
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const { writeContractAsync } = useWriteContract();
  const { data: _receipt } = useWaitForTransactionReceipt();
  void _receipt;
  const habitCreation = useCreateHabit();

  // Both true once their on-chain step has succeeded *in this session* — a live walletAddress
  // (a real on-chain read) always implies penalty was configured too, since deploy always came
  // after it in this flow, so `penaltyDone` covers both "just configured it" and "resuming with
  // an already-set-up wallet" without needing to separately re-derive the former from chain.
  const [penaltyConfigured, setPenaltyConfigured] = useState(false);
  const [walletDeployed, setWalletDeployed] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const {
    walletAddress,
    symbol: vaultSymbol,
    assetDecimals: vaultAssetDecimals,
    availableFormatted,
    refetchWalletAddress,
    refetchAll: refetchVault,
  } = useAccountabilityWallet();
  const { deposit: doDeposit, busy: depositing, error: depositError } = useVaultTransfer();
  const penaltyDone = penaltyConfigured || Boolean(walletAddress);

  const { data: donationAddressData } = useReadContract({
    address: addresses.penaltyEngine,
    abi: abis.penaltyEngine,
    functionName: "donationAddress",
    chainId: activeChain.id,
    query: { enabled: Boolean(addresses.penaltyEngine) },
  });
  const donationAddress = donationAddressData as `0x${string}` | undefined;

  // Once the vault exists and already covers the first habit's stake — whether from the merged
  // deploy+fund call just above, or because it was already sufficient from an earlier session —
  // there's nothing left to do on this screen, so move straight to creating the habit instead of
  // requiring one more "Continue" click. setState deferred to a microtask (rather than called
  // synchronously in the effect body) per this repo's react-hooks/set-state-in-effect gotcha —
  // same pattern app/page.tsx's wallet-switch-detection effect already uses.
  useEffect(() => {
    if (step === "setup" && walletAddress && Number(availableFormatted) >= Number(stakeAmount)) {
      Promise.resolve().then(() => setStep("habit"));
    }
  }, [step, walletAddress, availableFormatted, stakeAmount]);

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
          body: JSON.stringify({
            contractIndex: h.contractIndex,
            name,
            isNewHabit: true,
            stakeAmountWei: h.stakeAmountWei,
            assetSymbol: vaultSymbol,
            assetDecimals: vaultAssetDecimals,
          }),
        });
        if (!res.ok) throw new Error("Failed to save a recovered habit — try again");
      }
      await recheckUnmirrored();
      setStep("done");
      onComplete();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Failed to save recovered habits"));
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
    setError("Cancelled — check your wallet for a stuck request, then try again.");
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
      setStep("setup");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not save profile"));
    } finally {
      setBusy(false);
    }
  }

  async function submitHabit() {
    const decimals = vaultAsset === "usdc" ? 6 : 18;
    const assetSymbol = vaultAsset === "usdc" ? "USDC" : "MON";
    // stakeAmount was chosen in the "setup" step, before a habit even existed to attach it to —
    // this is the only place it's actually spent, locked into this specific habit forever (see
    // useCreateHabit.ts). Nothing wallet-level stores it.
    const ok = await habitCreation.createHabit(habitName, stakeAmount, decimals, assetSymbol, targetDays, deadlineTime);
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

      // Only the consequence *type* is set on-chain here now — stakeAmount stays purely local
      // state until either the deploy-with-deposit call just below, or (for the first habit)
      // submitHabit() above, actually spends it. There's no more wallet-level amount to
      // configure.
      await writeContractAsync({
        address: addresses.penaltyEngine!,
        abi: abis.penaltyEngine,
        functionName: "configurePenalty",
        args: [PENALTY_TYPE_INDEX[penaltyType]],
        chainId: activeChain.id,
      });
      if (cancelledRef.current) return;

      // assetSymbol/assetDecimals still mirrored here (not amount) — WalletStatus.tsx's
      // recovery path needs to know which asset to deploy before a vault exists to ask
      // directly, same as before.
      const mirrorRes = await fetch("/api/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ penaltyType, assetSymbol, assetDecimals: decimals }),
      });
      if (!mirrorRes.ok) throw new Error("Penalty configured on-chain but failed to save — refresh and try again");
      // Stays on "setup" — the same screen now reveals the deploy-and-fund action below, using
      // the same stakeAmount/vaultAsset the user already entered above.
      setPenaltyConfigured(true);
    } catch (err) {
      if (!cancelledRef.current) setError(friendlyErrorMessage(err, "Failed to configure penalty on-chain"));
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  const showBack = step !== "done";

  const STEP_NUMBER: Record<(typeof STEPS)[number], number> = { profile: 1, setup: 2, habit: 3, done: 3 };
  const totalSteps = 3;
  const currentStepNumber = STEP_NUMBER[step];

  return (
    <div className="mx-auto w-full max-w-sm space-y-4">
      {step !== "done" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              Step {currentStepNumber} of {totalSteps}
            </p>
            <button
              onClick={() => setHowItWorksOpen(true)}
              className="text-xs text-muted underline transition-transform duration-150 ease-emil-out hover:text-foreground active:scale-[0.97]"
            >
              How it works
            </button>
          </div>
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
        <button
          onClick={step === "profile" ? onBackToLanding : back}
          className="flex items-center gap-1 text-xs text-muted underline"
        >
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
            Name each active on-chain habit to bring it into your dashboard.
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
                  Stuck? Cancel and retry
                </button>
              )}
              {habitCreation.error && <p className="text-xs text-red-500">{habitCreation.error}</p>}
            </>
          ) : (
            <WalletReconnect />
          )}
        </div>
      )}

      {step === "setup" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-white/70">If you miss a day</label>
          <div className="grid grid-cols-2 gap-2">
            {PENALTY_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setPenaltyType(type)}
                disabled={penaltyDone}
                className={`relative rounded-md px-3 py-2 text-left text-sm transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-70 ${
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
              Stake goes to Savings Vault — still yours, released after the lock period.
            </p>
          ) : (
            <p className="text-xs text-muted">A missed day sends your stake to Argus, immediately.</p>
          )}

          <label className="block text-sm font-medium text-white/70">Amount at stake for your first habit</label>
          <div className="flex gap-2">
            <input
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              disabled={penaltyDone}
              inputMode="decimal"
              className="flex-1 rounded-md bg-surface px-3 py-2 text-sm disabled:opacity-70"
            />
            <div className="flex gap-1 rounded-md p-0.5">
              <button
                onClick={() => setVaultAsset("mon")}
                disabled={penaltyDone}
                className={`rounded px-3 py-1.5 text-xs transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-70 ${vaultAsset === "mon" ? "bg-surface text-foreground" : "text-muted"}`}
              >
                MON
              </button>
              <button
                onClick={() => setVaultAsset("usdc")}
                disabled={penaltyDone || !addresses.usdc}
                className={`rounded px-3 py-1.5 text-xs transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-40 ${
                  vaultAsset === "usdc" ? "bg-surface text-foreground" : "text-muted"
                }`}
              >
                USDC
              </button>
            </div>
          </div>
          <p className="text-xs text-muted">
            Sets your wallet&apos;s asset too. This exact amount also funds your wallet in the next step, so proof
            always has real weight behind it right away.
          </p>
          {(!stakeAmount || Number(stakeAmount) <= 0) && (
            <p className="text-xs text-red-500">
              A stake amount is required — missing a day needs a real consequence.
            </p>
          )}

          {!penaltyDone ? (
            isConnected ? (
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
                    Stuck? Cancel and retry
                  </button>
                )}
              </>
            ) : (
              <WalletReconnect />
            )
          ) : (
            <div className="space-y-3 border-t border-white/10 pt-3">
              {/* `walletAddress` (a live on-chain read via useAccountabilityWallet —
                  ArgusFactory.walletOf(user)) always wins over `walletDeployed`'s own
                  session-local state: a user who already has a vault (from a previous completed
                  setup, or from resuming onboarding after leaving mid-flow post-deploy) must
                  never see the deploy form again — clicking Deploy a second time reverts
                  on-chain with ArgusFactory.WalletAlreadyDeployed(), confirmed live.
                  `walletDeployed` only still matters for the brief window right after *this
                  session's own* deploy tx confirms, before the walletAddress read has caught
                  up. */}
              {!walletAddress && !walletDeployed && (
                <>
                  <p className="text-xs text-muted">
                    One more signature deploys your Accountability Wallet — a vault you own,
                    Argus never holds your funds — and funds it with {stakeAmount} {vaultAsset === "usdc" ? "USDC" : "MON"} in the
                    same transaction.
                  </p>
                  <DeployWalletForm
                    asset={vaultAsset}
                    initialDeposit={stakeAmount}
                    assetDecimals={vaultAsset === "usdc" ? 6 : 18}
                    onDeployed={() => {
                      setWalletDeployed(true);
                      refetchWalletAddress();
                    }}
                  />
                </>
              )}

              {!walletAddress && walletDeployed && <p className="text-center text-sm text-muted">Setting up your vault…</p>}

              {/* Reached only if a vault already exists but isn't yet funded enough — the
                  useEffect above already advances straight past this once it is, so this is a
                  fallback for resuming an interrupted/older setup, not the common path. */}
              {walletAddress && Number(availableFormatted) < Number(stakeAmount) && (
                <>
                  <label className="block text-sm font-medium text-white/70">Fund your wallet</label>
                  <p className="text-xs text-muted">
                    Deposit at least {stakeAmount} {vaultSymbol} — your habit&apos;s stake — so proof always has real weight.
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
                </>
              )}
            </div>
          )}
        </div>
      )}

      {step === "done" && <p className="text-center text-sm text-muted">All set — loading your dashboard…</p>}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <WelcomeModal open={howItWorksOpen} onClose={() => setHowItWorksOpen(false)} />
    </div>
  );
}
