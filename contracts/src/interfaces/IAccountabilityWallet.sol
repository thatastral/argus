// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAccountabilityWallet {
    function executePenalty(uint256 amount, address payable recipient) external;
    function moveToSavingsVault(uint256 amount) external;
    function balanceOf() external view returns (uint256);
    function committedAmount() external view returns (uint256);
    function availableBalance() external view returns (uint256);
}
