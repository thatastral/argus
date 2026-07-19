"use client";

import { useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Check, Copy, Power } from "@phosphor-icons/react";
import { parseUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { useVaultTransfer } from "@/hooks/useVaultTransfer";
import { ConfirmDialog } from "./ConfirmDialog";
import { WalletReconnect } from "./WalletReconnect";
import { DeployWalletForm } from "./DeployWalletForm";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";
import { useToast } from "./Toast";
import { friendlyErrorMessage } from "@/lib/formatError";

/// Shared address/copy/explorer/disconnect row for the vault address.
function WalletHeaderRow({ address, onSignOut }: { address: `0x${string}`; onSignOut: () => void }) {
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 rounded-full bg-surface px-3 py-2">
        <span className="font-mono text-xs">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button onClick={copyAddress} aria-label="Copy address" className="text-muted hover:text-foreground">
          {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <a
          href={`${activeChain.blockExplorers?.default.url}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          aria-label="View on explorer"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted transition-transform duration-150 ease-emil-out hover:text-foreground active:scale-[0.97]"
        >
          <ArrowSquareOut size={14} weight="bold" />
        </a>
        <div className="group relative">
          <button
            onClick={onSignOut}
            aria-label="Disconnect & switch wallet"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-warning transition-transform duration-150 ease-emil-out active:scale-[0.97]"
          >
            <Power size={16} weight="bold" />
          </button>
          <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-44 rounded-lg bg-card p-2 text-center text-xs text-muted opacity-0 shadow-lg transition-opacity [@media(hover:hover)]:group-hover:opacity-100">
            Disconnect &amp; switch wallet
          </div>
        </div>
      </div>
    </div>
  );
}

/// Deposit/withdraw controls — rendered inside the Wallet modal. The balance number itself also
/// lives in the home screen hero (useAccountabilityWallet is the shared source for both).
export function WalletStatus({
  onSignOut,
  configuredAssetSymbol,
}: {
  onSignOut: () => void;
  // From state.penalty.asset_symbol (app/page.tsx) — the asset the user's already-configured
  // stake amount was parsed with during onboarding's penalty step, reachable here since the
  // "no vault yet" recovery branch below needs to deploy that exact same asset, not offer a
  // fresh, independently changeable choice — see DeployWalletForm.tsx's doc comment for why a
  // mismatch there silently breaks committedAmount().
  configuredAssetSymbol: string | null;
}) {
  const { address, isConnected } = useAccount();
  const {
    walletAddress,
    assetAddress,
    isMockUsdc,
    symbol,
    balanceFormatted,
    availableFormatted,
    committedFormatted,
    savingsVaultFormatted,
    savingsVaultUnlockAt,
    savingsVaultLocked,
    balancesLoading,
    refetchBalance,
    refetchAll,
    refetchWalletAddress,
  } = useAccountabilityWallet();
  const {
    deposit: doDeposit,
    withdraw: doWithdraw,
    busy,
    activeAction,
    error: transferError,
  } = useVaultTransfer();
  const toast = useToast();

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const error = transferError ?? mintError;

  const { writeContractAsync } = useWriteContract();

  async function deposit() {
    if (await doDeposit(depositAmount)) {
      toast(`Deposited ${depositAmount} ${symbol}`);
      setDepositAmount("");
    }
  }

  async function withdraw() {
    if (await doWithdraw(withdrawAmount)) {
      toast(`Withdrew ${withdrawAmount} ${symbol}`);
      setWithdrawAmount("");
    }
    setConfirmingWithdraw(false);
  }

  async function mintTestUsdc() {
    if (!address || !assetAddress) return;
    setMinting(true);
    setMintError(null);
    try {
      await writeContractAsync({
        address: assetAddress,
        abi: abis.erc20,
        functionName: "mint",
        args: [address, parseUnits("100", 6)],
        chainId: activeChain.id,
      });
      refetchBalance();
    } catch (err) {
      setMintError(friendlyErrorMessage(err, "Mint failed"));
    } finally {
      setMinting(false);
    }
  }

  if (!walletAddress) {
    // No vault yet: reachable if setup was left mid-way (e.g. a habit was created but the
    // wallet-deploy step never finished) — previously a dead end with no way back in from the
    // dashboard. Let them finish right here instead.
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Wallet not set up yet.</p>
        <DeployWalletForm
          asset={configuredAssetSymbol === "USDC" ? "usdc" : "mon"}
          onDeployed={refetchWalletAddress}
        />
      </div>
    );
  }

  const exceedsAvailable = Boolean(withdrawAmount) && Number(withdrawAmount) > Number(availableFormatted);

  return (
    <div className="space-y-4">
      {/* Real on-chain address, fundable independently of the Deposit button below — this was
          previously computed internally (useAccountabilityWallet) but never surfaced anywhere
          in the UI, which was the whole reason it was hard to find. */}
      <WalletHeaderRow address={walletAddress} onSignOut={onSignOut} />

      <div className="flex items-center gap-2">
        <p className="text-2xl font-medium">
          {balancesLoading ? "…" : `${balanceFormatted} ${symbol}`}
        </p>
        <button
          onClick={() => refetchAll()}
          aria-label="Refresh balance"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-muted transition-transform duration-150 ease-emil-out hover:text-foreground active:scale-[0.97]"
        >
          <ArrowClockwise size={14} weight="bold" />
        </button>
      </div>

      {/* Never a wallet-wide lock anymore — only Committed (your standing stake) and, while
          still locked, the Savings Vault are ever unwithdrawable. Everything else is Available.
          Savings Vault always shows, even at $0/not-locked, so it's discoverable before a user
          ever misses a day — it previously only appeared once something was already locked.
          Each row is wrapped in a Tooltip — "Committed reads 0 despite a configured stake" was a
          real, reported point of confusion (Committed only reflects *active* habits: stake ×
          active habit count, so it's correctly 0 with none created yet). */}
      {balancesLoading ? (
        <div className="rounded-md bg-surface p-3 text-xs text-muted">Loading…</div>
      ) : (
        <div className="space-y-1 rounded-md bg-surface p-3">
          <div className="flex items-center justify-between text-xs">
            <Tooltip label="Never locked — withdraw anytime.">
              <span className="text-muted underline decoration-dotted">Available — withdraw anytime</span>
            </Tooltip>
            <span>
              {Number(availableFormatted).toFixed(4)} {symbol}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <Tooltip label="Stake × active habits. Shows 0 with no active habits.">
              <span className="text-muted underline decoration-dotted">Committed — your active stake</span>
            </Tooltip>
            <span>
              {Number(committedFormatted).toFixed(4)} {symbol}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <Tooltip label="Your funds — released when lock ends.">
              <span className="text-muted underline decoration-dotted">
                {savingsVaultLocked
                  ? `Savings Vault — locked until ${new Date(savingsVaultUnlockAt * 1000).toLocaleDateString()}`
                  : "Savings Vault — not locked"}
              </span>
            </Tooltip>
            <span>
              {Number(savingsVaultFormatted).toFixed(4)} {symbol}
            </span>
          </div>
          <p className="pt-1 text-[11px] text-muted">
            Missed day locks your stake here — still yours, just delayed.
          </p>
        </div>
      )}

      <p className="text-xs text-muted">
        You own this wallet — deposit below or send {symbol} here directly.
      </p>

      {isConnected ? (
        <>
          {/* Local dev only — never render in a real deployment. process.env.NODE_ENV is
              Next.js's own build-time value ("production" for any real build/deploy, whether
              that's a testnet or mainnet demo, "development" under `npm run dev`). */}
          {isMockUsdc && process.env.NODE_ENV !== "production" && (
            <button
              onClick={mintTestUsdc}
              disabled={minting}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-surface px-3 py-2 text-xs text-muted transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
            >
              {minting && <Spinner size={14} />}
              {minting ? "Minting…" : "Mint 100 test USDC to my wallet"}
            </button>
          )}

          <div className="flex gap-2">
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder={`Amount (${symbol})`}
              inputMode="decimal"
              className="flex-1 rounded-md bg-surface px-3 py-2 text-sm"
            />
            <button
              onClick={deposit}
              disabled={busy || !depositAmount || Number.isNaN(Number(depositAmount))}
              className="flex items-center gap-1.5 rounded-md bg-surface px-3 py-2 text-sm transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
            >
              {activeAction === "deposit" && <Spinner size={14} />}
              {activeAction === "deposit" ? "Depositing…" : "Deposit"}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder={`Amount (${symbol})`}
              inputMode="decimal"
              className="flex-1 rounded-md bg-surface px-3 py-2 text-sm"
            />
            <button
              onClick={() => setConfirmingWithdraw(true)}
              disabled={busy || !withdrawAmount || Number.isNaN(Number(withdrawAmount)) || exceedsAvailable}
              className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
            >
              {activeAction === "withdraw" && <Spinner size={14} />}
              {activeAction === "withdraw" ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>
          {exceedsAvailable && (
            <p className="text-xs text-red-500">
              Exceeds available balance ({Number(availableFormatted).toFixed(4)} {symbol}).
            </p>
          )}
        </>
      ) : (
        <WalletReconnect />
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <ConfirmDialog
        open={confirmingWithdraw}
        title="Confirm withdrawal"
        description={`Withdraw ${withdrawAmount} ${symbol} to your wallet?`}
        confirmLabel="Withdraw"
        pending={busy}
        onConfirm={withdraw}
        onCancel={() => setConfirmingWithdraw(false)}
      />
    </div>
  );
}
