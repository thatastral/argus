"use client";

import { useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits } from "viem";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { addresses, abis, NATIVE_ASSET } from "@/lib/contracts";
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

  const { data: assetAddress } = useReadContract({
    address: walletAddress,
    abi: abis.accountabilityWallet,
    functionName: "asset",
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) },
  });

  const isNative = assetAddress === NATIVE_ASSET;
  const isMockUsdc = Boolean(assetAddress && addresses.usdc && assetAddress === addresses.usdc);

  const { data: nativeBalance, refetch: refetchNativeBalance } = useBalance({
    address: walletAddress,
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) && isNative },
  });

  const { data: erc20Balance, refetch: refetchErc20Balance } = useReadContract({
    address: assetAddress as `0x${string}` | undefined,
    abi: abis.erc20,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress && assetAddress) && !isNative },
  });

  const { data: decimals } = useReadContract({
    address: assetAddress as `0x${string}` | undefined,
    abi: abis.erc20,
    functionName: "decimals",
    chainId: activeChain.id,
    query: { enabled: Boolean(assetAddress) && !isNative },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: assetAddress as `0x${string}` | undefined,
    abi: abis.erc20,
    functionName: "allowance",
    args: address && walletAddress ? [address, walletAddress] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && walletAddress && assetAddress) && !isNative },
  });

  const { data: isUnlocked, refetch: refetchUnlocked } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "isUnlockedToday",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager) },
  });

  function refetchBalance() {
    if (isNative) refetchNativeBalance();
    else refetchErc20Balance();
  }

  const assetDecimals = isNative ? 18 : (decimals as number | undefined) ?? 6;
  const assetSymbol = isNative ? "MON" : "USDC";
  const displayBalance = isNative
    ? nativeBalance
      ? formatEther(nativeBalance.value)
      : "0"
    : erc20Balance !== undefined
      ? formatUnits(erc20Balance as bigint, assetDecimals)
      : "0";

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
            address: assetAddress as `0x${string}`,
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

  const [minting, setMinting] = useState(false);
  async function mintTestUsdc() {
    if (!address || !assetAddress) return;
    setMinting(true);
    setError(null);
    try {
      await writeContractAsync({
        address: assetAddress as `0x${string}`,
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
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted">Wallet balance</p>
          <p className="text-2xl font-medium">
            {displayBalance} {assetSymbol}
          </p>
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
              placeholder={`Amount (${assetSymbol})`}
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
              placeholder={`Amount (${assetSymbol})`}
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
        description={`Withdraw ${withdrawAmount} ${assetSymbol} to your wallet?`}
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
