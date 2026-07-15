"use client";

import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { addresses, abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { ConfirmDialog } from "./ConfirmDialog";
import { WalletReconnect } from "./WalletReconnect";

export function WalletStatus() {
  const { address, isConnected } = useAccount();
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  const { data: accountabilityWallet } = useReadContract({
    address: addresses.argusFactory,
    abi: abis.argusFactory,
    functionName: "walletOf",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.argusFactory) },
  });

  const walletAddress =
    accountabilityWallet && accountabilityWallet !== "0x0000000000000000000000000000000000000000"
      ? (accountabilityWallet as `0x${string}`)
      : undefined;

  const { data: balance, refetch: refetchBalance } = useBalance({
    address: walletAddress,
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) },
  });

  const { data: isUnlocked, refetch: refetchUnlocked } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "isUnlockedToday",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager) },
  });

  async function deposit() {
    if (!walletAddress || !depositAmount) return;
    setBusy(true);
    setError(null);
    try {
      await writeContractAsync({
        address: walletAddress,
        abi: abis.accountabilityWallet,
        functionName: "deposit",
        value: parseEther(depositAmount),
        chainId: activeChain.id,
      });
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
      await writeContractAsync({
        address: walletAddress,
        abi: abis.accountabilityWallet,
        functionName: "withdraw",
        args: [parseEther(withdrawAmount)],
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

  if (!walletAddress) {
    return <p className="text-sm text-muted">No Accountability Wallet deployed yet.</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted">Wallet balance</p>
          <p className="text-2xl font-medium">{balance ? formatEther(balance.value) : "0"} MON</p>
        </div>
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
          <div className="flex gap-2">
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Amount (MON)"
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
              placeholder="Amount (MON)"
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
        description={`Withdraw ${withdrawAmount} MON to your wallet?`}
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
