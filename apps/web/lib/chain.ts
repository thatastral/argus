import "server-only";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";

const isMainnet = process.env.NEXT_PUBLIC_MONAD_NETWORK === "mainnet";
export const chain = isMainnet ? monad : monadTestnet;

export const publicClient = createPublicClient({
  chain,
  transport: http(),
});

/// Server-only wallet client for the HabitManager `verifier` role — the sole account
/// permitted to call completeHabit() after Gemini confirms a proof. Never expose this
/// key to the client; it holds no user funds, only permission to mark habits complete.
export function getVerifierWalletClient() {
  const key = process.env.VERIFIER_PRIVATE_KEY;
  if (!key) return null;

  const account = privateKeyToAccount(key as `0x${string}`);
  return createWalletClient({ account, chain, transport: http() });
}

export const contractAddresses = {
  habitManager: process.env.NEXT_PUBLIC_HABIT_MANAGER_ADDRESS as Address | undefined,
  penaltyEngine: process.env.NEXT_PUBLIC_PENALTY_ENGINE_ADDRESS as Address | undefined,
  argusFactory: process.env.NEXT_PUBLIC_ARGUS_FACTORY_ADDRESS as Address | undefined,
};
