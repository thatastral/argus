export const PENALTY_TYPES = ["save", "donate", "partner", "surprise"] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

// Must match PenaltyEngine.PenaltyType's Solidity enum order exactly.
export const PENALTY_TYPE_INDEX: Record<PenaltyType, number> = { save: 0, donate: 1, partner: 2, surprise: 3 };

export const PENALTY_TYPE_LABEL: Record<PenaltyType, string> = {
  save: "Save",
  donate: "Donate",
  partner: "Accountability Partner",
  surprise: "Surprise",
};
