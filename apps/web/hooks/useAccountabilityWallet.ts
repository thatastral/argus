"use client";

import { formatEther, formatUnits } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { addresses, abis, NATIVE_ASSET } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";

/// Shared on-chain reads for the connected user's AccountabilityWallet — used by both the
/// home screen's balance hero and the Wallet bottom sheet, so there's one source of truth
/// for "which vault, which asset, what balance" instead of two components each re-deriving it.
export function useAccountabilityWallet() {
  const { address } = useAccount();

  const { data: rawWalletAddress } = useReadContract({
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

  const { data: isUnlocked, refetch: refetchUnlocked } = useReadContract({
    address: addresses.habitManager,
    abi: abis.habitManager,
    functionName: "isUnlockedToday",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && addresses.habitManager) },
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

  function refetchBalance() {
    if (isNative) refetchNativeBalance();
    else refetchErc20Balance();
  }

  return {
    walletAddress,
    assetAddress: assetAddress as `0x${string}` | undefined,
    isNative,
    isMockUsdc,
    symbol,
    assetDecimals,
    balanceFormatted,
    isUnlocked: Boolean(isUnlocked),
    refetchBalance,
    refetchUnlocked,
  };
}
