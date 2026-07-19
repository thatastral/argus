// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {HabitManager} from "../src/HabitManager.sol";

contract HabitManagerTest is ArgusTestBase {
    address internal user = makeAddr("user");

    function test_createHabit_setsActiveAndUnlockStartsFalse() public {
        vm.prank(user);
        habitManager.createHabit(1 ether);

        assertEq(habitManager.habitCount(user), 1);
        assertFalse(habitManager.isUnlockedToday(user));
    }

    function test_createHabit_revertsOnZeroStake() public {
        vm.prank(user);
        vm.expectRevert(HabitManager.ZeroStake.selector);
        habitManager.createHabit(0);
    }

    function test_createHabit_revertsAfterMax() public {
        vm.startPrank(user);
        habitManager.createHabit(1 ether);
        habitManager.createHabit(1 ether);
        habitManager.createHabit(1 ether);
        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit(1 ether);
        vm.stopPrank();
    }

    /// The 3-habit cap gates *active* habits (_activeCount), not *pending stake*
    /// (pendingStake, added for committedAmount() — see AccountabilityWallet.sol) — a habit
    /// completed today is still active, still occupies one of the 3 slots, and must still block
    /// a 4th create. Only setHabitActive(index, false) ever frees a slot; completing one never
    /// does. Explicit regression guard per a direct instruction after pendingStake was added,
    /// since it would be a real bug for createHabit()'s cap to accidentally start reading it too.
    /// Also doubles as the per-habit-stake sum test: each of the 3 habits locks in a different
    /// amount at creation, and pendingStake must reflect exactly the still-pending ones' sum.
    function test_createHabit_revertsAfterMax_evenWithSomeCompletedToday() public {
        vm.startPrank(user);
        habitManager.createHabit(0.1 ether); // index 0
        habitManager.createHabit(0.2 ether); // index 1
        habitManager.createHabit(0.3 ether); // index 2 — 3 active, MAX_HABITS
        vm.stopPrank();

        vm.startPrank(verifier);
        habitManager.completeHabit(user, 0);
        habitManager.completeHabit(user, 1);
        vm.stopPrank();

        // Only index 2 (0.3 ether) is still pending today, but all 3 are still active — must
        // still revert.
        assertEq(habitManager.pendingStake(user), 0.3 ether);
        assertEq(habitManager.activeHabitCount(user), 3);
        vm.prank(user);
        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit(1 ether);
    }

    function test_createHabit_lockedInStakeUnaffectedByLaterHabits() public {
        // A direct instruction: creating a later habit with a different stake must never change
        // an earlier habit's own already-locked-in amount.
        vm.startPrank(user);
        habitManager.createHabit(1 ether); // index 0
        assertEq(habitManager.habitStake(user, 0), 1 ether);

        habitManager.createHabit(0.25 ether); // index 1, deliberately different
        assertEq(habitManager.habitStake(user, 0), 1 ether); // unchanged
        assertEq(habitManager.habitStake(user, 1), 0.25 ether);
        vm.stopPrank();
    }

    function test_createHabit_deactivatingFreesASlot() public {
        vm.startPrank(user);
        habitManager.createHabit(1 ether);
        habitManager.createHabit(1 ether);
        habitManager.createHabit(1 ether);
        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit(1 ether);

        habitManager.setHabitActive(1, false);
        habitManager.createHabit(1 ether); // now 3 active again (0, 2, 3) — should succeed
        assertEq(habitManager.habitCount(user), 4);

        vm.expectRevert(HabitManager.TooManyHabits.selector);
        habitManager.createHabit(1 ether); // 3 active again, no room
        vm.stopPrank();
    }

    function test_completeHabit_onlyVerifier() public {
        vm.prank(user);
        habitManager.createHabit(1 ether);

        vm.prank(user);
        vm.expectRevert(HabitManager.NotVerifier.selector);
        habitManager.completeHabit(user, 0);
    }

    function test_isUnlockedToday_trueOnceAllActiveCompleted() public {
        vm.startPrank(user);
        habitManager.createHabit(1 ether);
        habitManager.createHabit(1 ether);
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
        habitManager.createHabit(1 ether);

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
        habitManager.createHabit(1 ether);
        // habit never completed today

        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(habitManager.currentStreak(user), 0);
        assertEq(habitManager.totalDaysSettled(user), 1);
        assertEq(habitManager.totalCompletedDays(user), 0);
    }

    function test_settle_revertsIfNothingOwedYet() public {
        vm.prank(user);
        habitManager.createHabit(1 ether);

        vm.expectRevert(HabitManager.NothingToSettle.selector);
        habitManager.settle(user);
    }

    function test_completionRateBps() public {
        vm.prank(user);
        habitManager.createHabit(1 ether);

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
