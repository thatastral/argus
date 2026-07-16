// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read-only view of PenaltyEngine used by AccountabilityWallet to compute its own
/// committedAmount() and the Savings Vault's lock duration, without duplicating either value.
interface IPenaltyEngineView {
    function penaltyAmountOf(address user) external view returns (uint256);
    function SAVINGS_VAULT_LOCK_PERIOD() external view returns (uint256);
}
