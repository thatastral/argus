// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read-only view of PenaltyEngine used by AccountabilityWallet for the Savings Vault's
/// lock duration, without duplicating it. (committedAmount() itself now reads
/// HabitManager.pendingStake directly — PenaltyEngine no longer stores a stake amount at all.)
interface IPenaltyEngineView {
    function SAVINGS_VAULT_LOCK_PERIOD() external view returns (uint256);
}
