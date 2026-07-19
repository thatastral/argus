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

    /// The 3-habit cap gates *active* habits (_activeCount), not *pending* ones
    /// (pendingHabitCount, added for committedAmount() — see AccountabilityWallet.sol) — a habit
    /// completed today is still active, still occupies one of the 3 slots, and must still block
    /// a 4th create. Only setHabitActive(index, false) ever frees a slot; completing one never
    /// does. Explicit regression guard per a direct instruction after pendingHabitCount was added,
    /// since it would be a real bug for createHabit()'s cap to accidentally start reading it too.
    function test_createHabit_revertsAfterMax_evenWithSomeCompletedToday() public {
        vm.startPrank(user);
        habitManager.createHabit(); // index 0
        habitManager.createHabit(); // index 1
        habitManager.createHabit(); // index 2 — 3 active, MAX_HABITS
        vm.stopPrank();

        vm.startPrank(verifier);
        habitManager.completeHabit(user, 0);
        habitManager.completeHabit(user, 1);
        vm.stopPrank();

        // Only 1 of the 3 is still pending today, but all 3 are still active — must still revert.
        assertEq(habitManager.pendingHabitCount(user), 1);
        assertEq(habitManager.activeHabitCount(user), 3);
        vm.prank(user);
        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit();
    }

    function test_createHabit_deactivatingFreesASlot() public {
        vm.startPrank(user);
        habitManager.createHabit();
        habitManager.createHabit();
        habitManager.createHabit();
        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit();

        habitManager.setHabitActive(1, false);
        habitManager.createHabit(); // now 3 active again (0, 2, 3) — should succeed
        assertEq(habitManager.habitCount(user), 4);

        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit(); // 3 active again, no room
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
