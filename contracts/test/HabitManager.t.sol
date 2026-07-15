// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {HabitManager} from "../src/HabitManager.sol";

contract HabitManagerTest is ArgusTestBase {
    address internal user = makeAddr("user");

    function test_createHabit_setsActiveAndUnlockStartsFalse() public {
        vm.prank(user);
        habitManager.createHabit();

        assertEq(habitManager.habitCount(user), 1);
        assertFalse(habitManager.isUnlockedToday(user));
    }

    function test_createHabit_revertsAfterMax() public {
        vm.startPrank(user);
        habitManager.createHabit();
        habitManager.createHabit();
        habitManager.createHabit();
        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit();
        vm.stopPrank();
    }

    function test_completeHabit_onlyVerifier() public {
        vm.prank(user);
        habitManager.createHabit();

        vm.prank(user);
        vm.expectRevert(HabitManager.NotVerifier.selector);
        habitManager.completeHabit(user, 0);
    }

    function test_isUnlockedToday_trueOnceAllActiveCompleted() public {
        vm.startPrank(user);
        habitManager.createHabit();
        habitManager.createHabit();
        vm.stopPrank();

        vm.prank(verifier);
        habitManager.completeHabit(user, 0);
        assertFalse(habitManager.isUnlockedToday(user));

        vm.prank(verifier);
        habitManager.completeHabit(user, 1);
        assertTrue(habitManager.isUnlockedToday(user));
    }

    function test_settle_successIncrementsStreak() public {
        vm.prank(user);
        habitManager.createHabit();

        vm.prank(verifier);
        habitManager.completeHabit(user, 0);

        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(habitManager.currentStreak(user), 1);
        assertEq(habitManager.longestStreak(user), 1);
        assertEq(habitManager.totalCompletedDays(user), 1);
    }

    function test_settle_failureResetsStreakAndTriggersPenalty() public {
        vm.prank(user);
        habitManager.createHabit();
        // habit never completed today

        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(habitManager.currentStreak(user), 0);
        assertEq(habitManager.totalDaysSettled(user), 1);
        assertEq(habitManager.totalCompletedDays(user), 0);
    }

    function test_settle_revertsIfNothingOwedYet() public {
        vm.prank(user);
        habitManager.createHabit();

        vm.expectRevert(HabitManager.NothingToSettle.selector);
        habitManager.settle(user);
    }

    function test_completionRateBps() public {
        vm.prank(user);
        habitManager.createHabit();

        vm.prank(verifier);
        habitManager.completeHabit(user, 0);
        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        // day 2: missed
        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(habitManager.completionRateBps(user), 5_000); // 1 of 2 days = 50%
    }
}
