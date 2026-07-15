"use client";

import { useState } from "react";
import { parseEther, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
import { ConfirmDialog } from "./ConfirmDialog";
import { WalletReconnect } from "./WalletReconnect";

/// Deposit/withdraw controls — rendered inside the Wallet bottom sheet. The balance number
/// itself lives in the home screen hero (useAccountabilityWallet is the shared source for both).
export function WalletStatus() {
  const { address, isConnected } = useAccount();
  const {
    walletAddress,
    assetAddress,
    isNative,
    isMockUsdc,
    symbol,
    assetDecimals,
    balanceFormatted,
    isUnlocked,
    refetchBalance,
    refetchUnlocked,
  } = useAccountabilityWallet();

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: assetAddress,
    abi: abis.erc20,
    functionName: "allowance",
    args: address && walletAddress ? [address, walletAddress] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && walletAddress && assetAddress) && !isNative },
  });

  async function deposit() {
    if (!walletAddress || !depositAmount) return;
    setBusy(true);
    setError(null);
    try {
      const amount = isNative ? parseEther(depositAmount) : parseUnits(depositAmount, assetDecimals);

      if (isNative) {
        await writeContractAsync({
          address: walletAddress,
          abi: abis.accountabilityWallet,
          functionName: "deposit",
          value: amount,
          chainId: activeChain.id,
        });
      } else {
        if (!allowance || (allowance as bigint) < amount) {
          await writeContractAsync({
            address: assetAddress!,
            abi: abis.erc20,
            functionName: "approve",
            args: [walletAddress, amount],
            chainId: activeChain.id,
          });
          await refetchAllowance();
        }
        await writeContractAsync({
          address: walletAddress,
          abi: abis.accountabilityWallet,
          functionName: "depositERC20",
          args: [amount],
          chainId: activeChain.id,
        });
      }

      setDepositAmount("");
      refetchBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!walletAddress || !withdrawAmount) return;
    setBusy(true);
    setError(null);
    try {
      const amount = isNative ? parseEther(withdrawAmount) : parseUnits(withdrawAmount, assetDecimals);
      await writeContractAsync({
        address: walletAddress,
        abi: abis.accountabilityWallet,
        functionName: "withdraw",
        args: [amount],
        chainId: activeChain.id,
      });
      setWithdrawAmount("");
      refetchBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed — wallet may still be locked");
    } finally {
      setBusy(false);
      setConfirmingWithdraw(false);
    }
  }

  async function mintTestUsdc() {
    if (!address || !assetAddress) return;
    setMinting(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  }

  if (!walletAddress) {
    return <p className="text-sm text-muted">No Accountability Wallet deployed yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          {balanceFormatted} {symbol}
        </p>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            isUnlocked ? "bg-surface text-foreground" : "border border-border text-muted"
          }`}
        >
          {isUnlocked ? "Unlocked" : "Locked"}
        </span>
      </div>

      {isConnected ? (
        <>
          {isMockUsdc && (
            <button
              onClick={mintTestUsdc}
              disabled={minting}
              className="w-full rounded-md border border-border px-3 py-2 text-xs text-muted disabled:opacity-50"
            >
              {minting ? "Minting…" : "Mint 100 test USDC to my wallet"}
            </button>
          )}

          <div className="flex gap-2">
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder={`Amount (${symbol})`}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={deposit}
              disabled={busy || !depositAmount}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              Deposit
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder={`Amount (${symbol})`}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={() => setConfirmingWithdraw(true)}
              disabled={busy || !withdrawAmount || !isUnlocked}
              className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
            >
              Withdraw
            </button>
          </div>
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

      <button onClick={() => refetchUnlocked()} className="text-xs text-muted underline">
        Refresh status
      </button>
    </div>
  );
}
