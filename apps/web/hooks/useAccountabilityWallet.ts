"use client";

import { useState } from "react";
import { formatEther, formatUnits } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { addresses, abis, NATIVE_ASSET } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";

/// Shared on-chain reads for the connected user's AccountabilityWallet — used by both the
/// home screen's balance hero and the Wallet bottom sheet, so there's one source of truth
/// for "which vault, which asset, what balance" instead of two components each re-deriving it.
///
/// Three logical balances (see AccountabilityWallet.sol's contract-level doc comment): Available
/// is always withdrawable, Committed is the user's own standing stake (a live view, not a
/// separate transaction), Savings Vault is what a missed day moved there, locked until
/// savingsVaultUnlockAt. There's no more wallet-wide "locked/unlocked" gate — that model was
/// removed along with Hard Mode; withdraw() now only ever checks availableBalance().
export function useAccountabilityWallet() {
  const { address } = useAccount();

  const { data: rawWalletAddress, refetch: refetchWalletAddress } = useReadContract({
    address: addresses.argusFactory,
    abi: abis.argusFactory,
    functionName: "walletOf",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.argusFactory) },
  });

  const walletAddress =
    rawWalletAddress && rawWalletAddress !== "0x0000000000000000000000000000000000000000"
      ? (rawWalletAddress as `0x${string}`)
      : undefined;

  const { data: assetAddress } = useReadContract({
    address: walletAddress,
    abi: abis.accountabilityWallet,
    functionName: "asset",
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) },
  });

  // `assetAddress` starts `undefined` while its own read is still in flight — until it resolves,
  // `isNative` can't be trusted (it silently reads as `false`, `undefined !== NATIVE_ASSET`).
  // Anything that formats a raw on-chain amount using assetDecimals must wait for this, or a
  // still-loading native (18-decimal) vault gets formatted with the ERC-20 fallback of 6
  // decimals — inflating the displayed number by 10^12. Confirmed live as a huge bogus balance
  // shown briefly on first load.
  const assetResolved = assetAddress !== undefined;
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

  const { data: rawAvailable, refetch: refetchAvailable } = useReadContract({
    address: walletAddress,
    abi: abis.accountabilityWallet,
    functionName: "availableBalance",
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) && assetResolved },
  });

  const { data: rawCommitted, refetch: refetchCommitted } = useReadContract({
    address: walletAddress,
    abi: abis.accountabilityWallet,
    functionName: "committedAmount",
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) && assetResolved },
  });

  const { data: rawSavingsVaultAmount, refetch: refetchSavingsVaultAmount } = useReadContract({
    address: walletAddress,
    abi: abis.accountabilityWallet,
    functionName: "savingsVaultAmount",
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) && assetResolved },
  });

  const { data: rawSavingsVaultUnlockAt, refetch: refetchSavingsVaultUnlockAt } = useReadContract({
    address: walletAddress,
    abi: abis.accountabilityWallet,
    functionName: "savingsVaultUnlockAt",
    chainId: activeChain.id,
    query: { enabled: Boolean(walletAddress) && assetResolved },
  });

  const assetDecimals = isNative ? 18 : ((decimals as number | undefined) ?? 6);
  const symbol = isNative ? "MON" : "USDC";
  const balanceFormatted = isNative
    ? nativeBalance
      ? formatEther(nativeBalance.value)
      : "0"
    : erc20Balance !== undefined
      ? formatUnits(erc20Balance as bigint, assetDecimals)
      : "0";

  function format(raw: unknown) {
    // Belt-and-suspenders alongside the `enabled: assetResolved` gates above — never format
    // against a still-guessed decimals value, even if a stale `raw` were somehow present.
    if (!assetResolved) return "0";
    return formatUnits((raw as bigint | undefined) ?? 0n, assetDecimals);
  }

  const availableFormatted = format(rawAvailable);
  const committedFormatted = format(rawCommitted);
  const savingsVaultFormatted = format(rawSavingsVaultAmount);
  const savingsVaultUnlockAt = rawSavingsVaultUnlockAt ? Number(rawSavingsVaultUnlockAt) : 0;

  // `Date.now()` can't be called directly in render (React's purity rule) — a lazy initializer
  // is the sanctioned one-time read (same pattern as useCountdownToDeadline.ts's initial state),
  // refreshed explicitly by refetchAll() below rather than on a ticking interval, since "locked
  // until" doesn't need per-second live updates the way an active countdown does.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // savingsVaultUnlockAt starts at 0 (never locked) — only treat it as an active lock once it's
  // actually in the future, matching the contract's own `block.timestamp < savingsVaultUnlockAt`
  // check in _lockedSavingsVault().
  const savingsVaultLocked = savingsVaultUnlockAt > nowMs / 1000;

  function refetchBalance() {
    if (isNative) refetchNativeBalance();
    else refetchErc20Balance();
  }

  function refetchAll() {
    refetchBalance();
    refetchAvailable();
    refetchCommitted();
    refetchSavingsVaultAmount();
    refetchSavingsVaultUnlockAt();
    setNowMs(Date.now());
  }

  return {
    walletAddress,
    assetAddress: assetAddress as `0x${string}` | undefined,
    isNative,
    isMockUsdc,
    symbol,
    assetDecimals,
    // True for the brief window where a vault is known to exist but its asset/decimals haven't
    // resolved yet — every *Formatted value is "0" during this window (see format() above), not
    // necessarily the real balance. Consumers should show a neutral loading state instead of a
    // bare "0" if they want to avoid a flash of a wrong-looking number.
    balancesLoading: Boolean(walletAddress) && !assetResolved,
    balanceFormatted,
    availableFormatted,
    committedFormatted,
    savingsVaultFormatted,
    savingsVaultUnlockAt,
    savingsVaultLocked,
    refetchBalance,
    refetchAll,
    refetchWalletAddress,
  };
}
