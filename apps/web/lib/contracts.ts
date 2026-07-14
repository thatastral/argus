import type { Address } from "viem";
import habitManagerAbi from "./abi/HabitManager.json";
import penaltyEngineAbi from "./abi/PenaltyEngine.json";
import argusFactoryAbi from "./abi/ArgusFactory.json";
import accountabilityWalletAbi from "./abi/AccountabilityWallet.json";

// Regenerate these with `npm run sync-abi` from the repo root after any contract change.
export const abis = {
  habitManager: habitManagerAbi,
  penaltyEngine: penaltyEngineAbi,
  argusFactory: argusFactoryAbi,
  accountabilityWallet: accountabilityWalletAbi,
} as const;

// Filled in after `forge script script/Deploy.s.sol` — see contracts/README.md.
export const addresses = {
  habitManager: process.env.NEXT_PUBLIC_HABIT_MANAGER_ADDRESS as Address | undefined,
  penaltyEngine: process.env.NEXT_PUBLIC_PENALTY_ENGINE_ADDRESS as Address | undefined,
  argusFactory: process.env.NEXT_PUBLIC_ARGUS_FACTORY_ADDRESS as Address | undefined,
};
