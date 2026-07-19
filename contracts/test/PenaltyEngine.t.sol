// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {AccountabilityWallet} from "../src/AccountabilityWallet.sol";
import {PenaltyEngine} from "../src/PenaltyEngine.sol";

contract PenaltyEngineTest is ArgusTestBase {
    address internal user = makeAddr("user");

    function _setupFailedDay(PenaltyEngine.PenaltyType penaltyType, uint256 amount)
        internal
        returns (AccountabilityWallet wallet)
    {
        wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.prank(user);
        penaltyEngine.configurePenalty(penaltyType);

        vm.prank(user);
        habitManager.createHabit(amount);
        // never completed -> day fails

        vm.warp(block.timestamp + 1 days);
    }

    function test_savingsVault_movesFundsIntoLockedBucket() public {
        AccountabilityWallet wallet = _setupFailedDay(PenaltyEngine.PenaltyType.SavingsVault, 0.5 ether);

        habitManager.settle(user);

        // Funds never leave the wallet — SavingsVault re-earmarks them, it isn't a transfer.
        assertEq(wallet.balanceOf(), 1 ether);
        assertEq(wallet.savingsVaultAmount(), 0.5 ether);
        // The habit's locked-in stake (0.5 ether) is a standing commitment, not a one-time
        // thing — it immediately re-commits from whatever's left (the other 0.5 ether) so the
        // user stays "at risk" going forward, which is why availableBalance is 0 here rather
        // than 0.5: the balance is now fully accounted for between what's locked and what's
        // freshly committed again. See test_savingsVault_reCommitsStakeFromRemainingBalance for
        // this in isolation.
        assertEq(wallet.availableBalance(), 0);
    }

    function test_savingsVault_reCommitsStakeFromRemainingBalance() public {
        // 1 ether balance, 0.5 ether stake — after the miss, 0.5 is locked in the Savings Vault
        // and the same 0.5 ether stake re-commits from the remaining 0.5, leaving nothing
        // available. Depositing more afterward should immediately free up the difference.
        AccountabilityWallet wallet = _setupFailedDay(PenaltyEngine.PenaltyType.SavingsVault, 0.5 ether);
        habitManager.settle(user);
        assertEq(wallet.availableBalance(), 0);

        vm.deal(user, 0.4 ether);
        vm.prank(user);
        wallet.deposit{value: 0.4 ether}();

        assertEq(wallet.committedAmount(), 0.5 ether);
        assertEq(wallet.availableBalance(), 0.4 ether);
    }

    function test_donate_movesFundsToDonationAddress() public {
        AccountabilityWallet wallet = _setupFailedDay(PenaltyEngine.PenaltyType.Donate, 0.3 ether);

        habitManager.settle(user);

        assertEq(wallet.balanceOf(), 0.7 ether);
        assertEq(donationAddress.balance, 0.3 ether);
    }

    function test_donate_movesFullMultiHabitAmount() public {
        // The scenario this fix exists for: 3 active habits, all missed on the same day (settle
        // is pass/fail per day, not per habit) — the moved amount must be the sum of all 3
        // habits' own stakes, not just one habit's worth.
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.Donate);
        habitManager.createHabit(0.1 ether);
        habitManager.createHabit(0.1 ether);
        habitManager.createHabit(0.1 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(donationAddress.balance, 0.3 ether);
        assertEq(wallet.balanceOf(), 0.7 ether);
    }

    function test_donate_clampsMultiHabitAmountToBalance() public {
        // Same 3-habit setup, but the balance can't cover the full 0.3 ether exposure — must
        // clamp to what's actually there (0.2 ether), never revert or move more than exists.
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 0.2 ether);
        vm.prank(user);
        wallet.deposit{value: 0.2 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.Donate);
        habitManager.createHabit(0.1 ether);
        habitManager.createHabit(0.1 ether);
        habitManager.createHabit(0.1 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(donationAddress.balance, 0.2 ether);
        assertEq(wallet.balanceOf(), 0);
    }

    function test_execute_revertsWhenNotHabitManager() public {
        vm.expectRevert(PenaltyEngine.NotHabitManager.selector);
        penaltyEngine.execute(user);
    }

    function test_execute_skipsWhenNoWalletDeployed() public {
        // A habit (with its own locked-in stake) exists, but the user never called
        // deployWallet().
        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.SavingsVault);
        habitManager.createHabit(0.5 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);

        // Must not revert — a missed day with no vault is a no-op, not an error.
        habitManager.settle(user);
        assertEq(habitManager.totalDaysSettled(user), 1);
    }

    function test_execute_skipsWhenNoBalanceDeposited() public {
        // A vault exists and a habit has a real locked-in stake, but nothing was ever deposited
        // — committedAmount() clamps to the actual balance (0), so there's nothing to move.
        deployWalletFor(user, address(0));
        vm.prank(user);
        habitManager.createHabit(0.5 ether);

        vm.warp(block.timestamp + 1 days);

        habitManager.settle(user);
        assertEq(habitManager.totalDaysSettled(user), 1);
    }
}
