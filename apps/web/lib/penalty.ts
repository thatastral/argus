// Accountability Partner and the "Shuffle/Raffle" (Surprise) consequence types were removed in
// the product realignment (see Downloads/Updates.md) — Savings Vault and Donate are the only
// two consequences now. Must match PenaltyEngine.PenaltyType's Solidity enum order exactly.
export const PENALTY_TYPES = ["savingsVault", "donate"] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

export const PENALTY_TYPE_INDEX: Record<PenaltyType, number> = { savingsVault: 0, donate: 1 };

export const PENALTY_TYPE_LABEL: Record<PenaltyType, string> = {
  savingsVault: "Savings Vault",
  donate: "Donate to Argus",
};
