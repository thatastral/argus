"use client";

import { useState } from "react";
import { parseEther, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { abis } from "@/lib/contracts";
import { activeChain } from "@/lib/wagmi";
import { friendlyErrorMessage } from "@/lib/formatError";
import { useAccountabilityWallet } from "./useAccountabilityWallet";

/// Deposit/withdraw against the connected user's Accountability Wallet — extracted out of
/// WalletStatus.tsx once components/ChatSidebar.tsx needed the exact same logic for
/// chat-proposed deposit/withdraw actions, so the ERC-20 approve-then-deposit dance and amount
/// parsing only exist in one place.
export function useVaultTransfer() {
  const { address } = useAccount();
  const { walletAddress, assetAddress, isNative, assetDecimals, refetchBalance, refetchAll } =
    useAccountabilityWallet();
  const { writeContractAsync } = useWriteContract();

  const [activeAction, setActiveAction] = useState<"deposit" | "withdraw" | null>(null);
  const busy = activeAction !== null;
  const [error, setError] = useState<string | null>(null);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: assetAddress,
    abi: abis.erc20,
    functionName: "allowance",
    args: address && walletAddress ? [address, walletAddress] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address && walletAddress && assetAddress) && !isNative },
  });

  async function deposit(amountStr: string): Promise<boolean> {
    if (!walletAddress || !amountStr) return false;
    setActiveAction("deposit");
    setError(null);
    try {
      const amount = isNative ? parseEther(amountStr) : parseUnits(amountStr, assetDecimals);

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

      refetchBalance();
      return true;
    } catch (err) {
      setError(friendlyErrorMessage(err, "Deposit failed"));
      return false;
    } finally {
      setActiveAction(null);
    }
  }

  async function withdraw(amountStr: string): Promise<boolean> {
    if (!walletAddress || !amountStr) return false;
    setActiveAction("withdraw");
    setError(null);
    try {
      const amount = isNative ? parseEther(amountStr) : parseUnits(amountStr, assetDecimals);
      await writeContractAsync({
        address: walletAddress,
        abi: abis.accountabilityWallet,
        functionName: "withdraw",
        args: [amount],
        chainId: activeChain.id,
      });
      refetchAll();
      return true;
    } catch (err) {
      setError(friendlyErrorMessage(err, "Withdraw failed — amount may exceed your Available balance"));
      return false;
    } finally {
      setActiveAction(null);
    }
  }

  return { deposit, withdraw, busy, activeAction, error };
}
