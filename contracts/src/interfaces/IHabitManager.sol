// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IHabitManager {
    function isUnlockedToday(address user) external view returns (bool);
}
