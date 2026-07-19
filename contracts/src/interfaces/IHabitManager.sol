// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IHabitManager {
    function isUnlockedToday(address user) external view returns (bool);
    function activeHabitCount(address user) external view returns (uint256);
    function pendingHabitCount(address user) external view returns (uint256);
}
