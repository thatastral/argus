import "server-only";
import { createPublicClient, createWalletClient, formatUnits, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";
import { abis, NATIVE_ASSET } from "./contracts";
import { supabaseAdmin } from "./supabase/server";

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

/// Best-effort catch-up for HabitManager.settle() — permissionless but nothing calls it
/// automatically yet (no cron, see CLAUDE.md's "Known gaps"). settle() only ever advances the
/// oldest un-settled day, so this loops it, using the already-funded verifier wallet as the gas
/// payer (anyone may call settle() for any user — no new trust granted). Stops on the first
/// revert, which is the expected/cheap path once caught up (a single eth_call, no tx).
/// Retries HabitManager.completeHabit() for any of today's `habit_completions` rows Gemini
/// verified but whose on-chain relay failed or was skipped — see the try/catch around
/// completeHabit in app/api/verify/route.ts, which deliberately swallows a relay failure so the
/// request can still return the AI's verdict, but leaves Supabase saying `verified: true` while
/// on-chain `completedOn` stays false for that habit/day. This mismatch was a real cause of
/// "streak isn't working": settle() checks the *on-chain* record, so a day that looked fully
/// "Completed" in the UI can still settle as a miss and reset the streak to 0.
///
/// completeHabit() always stamps *today's* on-chain day (block.timestamp-derived, no day
/// parameter) — so this can only ever fix a completion within the same UTC day it was verified.
/// Once the day rolls over there is no way to backfill it on-chain; the fix is calling this on
/// every dashboard load and verify (see /api/state, /api/verify) so a transient relay failure
/// gets many chances to succeed before that day's midnight cutoff, instead of the previous
/// single silent attempt.
export async function relayPendingCompletions(user: Address): Promise<number> {
  const verifierClient = getVerifierWalletClient();
  if (!verifierClient || !contractAddresses.habitManager) return 0;

  const supabase = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const { data: pending } = await supabase
    .from("habit_completions")
    .select("contract_index")
    .eq("wallet_address", user)
    .eq("day", today)
    .eq("verified", true)
    .is("onchain_tx_hash", null);

  let relayed = 0;
  for (const row of pending ?? []) {
    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddresses.habitManager,
        abi: abis.habitManager,
        functionName: "completeHabit",
        args: [user, BigInt(row.contract_index)],
        account: verifierClient.account,
      });
      const hash = await verifierClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      await supabase
        .from("habit_completions")
        .update({ onchain_tx_hash: hash })
        .eq("wallet_address", user)
        .eq("contract_index", row.contract_index)
        .eq("day", today);
      relayed++;
    } catch {
      // Still unrelayed — retried again on the next dashboard load or verify call today.
    }
  }
  return relayed;
}

export interface VaultSnapshot {
  walletAddress: Address;
  symbol: string;
  decimals: number;
  balance: string;
  available: string;
  committed: string;
}

/// On-chain snapshot of a user's Accountability Wallet for the chat coach's context (see
/// app/api/chat/route.ts) — it needs to know Available specifically before proposing a withdraw
/// tool call, since a Committed or still-locked Savings-Vault amount would just revert on-chain
/// otherwise. Returns null if no vault is deployed yet. Amounts come back as decimal strings
/// (already divided by the asset's decimals) so the model doesn't have to do the arithmetic.
export async function getVaultSnapshot(user: Address): Promise<VaultSnapshot | null> {
  if (!contractAddresses.argusFactory) return null;

  const walletAddress = (await publicClient.readContract({
    address: contractAddresses.argusFactory,
    abi: abis.argusFactory,
    functionName: "walletOf",
    args: [user],
  })) as Address;

  if (!walletAddress || walletAddress === "0x0000000000000000000000000000000000000000") return null;

  const [asset, balance, available, committed] = await Promise.all([
    publicClient.readContract({
      address: walletAddress,
      abi: abis.accountabilityWallet,
      functionName: "asset",
    }) as Promise<Address>,
    publicClient.readContract({
      address: walletAddress,
      abi: abis.accountabilityWallet,
      functionName: "balanceOf",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: walletAddress,
      abi: abis.accountabilityWallet,
      functionName: "availableBalance",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: walletAddress,
      abi: abis.accountabilityWallet,
      functionName: "committedAmount",
    }) as Promise<bigint>,
  ]);

  const isNative = asset === NATIVE_ASSET;
  // Hardcoded rather than an extra decimals() RPC read — every non-native asset in this codebase
  // (MockUSDC on testnet, real USDC on mainnet) is 6 decimals, same assumption WalletStatus.tsx's
  // mintTestUsdc already makes. Cuts a sequential round-trip from every chat turn (this snapshot
  // is fetched fresh on each /api/chat call — see route.ts).
  const decimals = isNative ? 18 : 6;

  return {
    walletAddress,
    symbol: isNative ? "MON" : "USDC",
    decimals,
    balance: formatUnits(balance, decimals),
    available: formatUnits(available, decimals),
    committed: formatUnits(committed, decimals),
  };
}

export async function settlePendingDays(user: Address, maxDays = 14): Promise<number> {
  const verifierClient = getVerifierWalletClient();
  if (!verifierClient || !contractAddresses.habitManager) return 0;

  let settled = 0;
  for (let i = 0; i < maxDays; i++) {
    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddresses.habitManager,
        abi: abis.habitManager,
        functionName: "settle",
        args: [user],
        account: verifierClient.account,
      });
      const hash = await verifierClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      settled++;
    } catch {
      break;
    }
  }
  return settled;
}
