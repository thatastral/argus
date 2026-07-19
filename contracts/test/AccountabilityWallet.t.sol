// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {AccountabilityWallet} from "../src/AccountabilityWallet.sol";
import {ArgusFactory} from "../src/ArgusFactory.sol";
import {PenaltyEngine} from "../src/PenaltyEngine.sol";

contract AccountabilityWalletTest is ArgusTestBase {
    address internal user = makeAddr("user");

    function test_deployWallet_ownedByUser() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        assertEq(wallet.owner(), user);
        assertEq(factory.walletOf(user), address(wallet));
    }

    function test_deployWallet_revertsOnSecondCall() public {
        deployWalletFor(user, address(0));
        vm.prank(user);
        vm.expectRevert(ArgusFactory.WalletAlreadyDeployed.selector);
        factory.deployWallet(address(0), 0);
    }

    function test_deployWallet_withInitialNativeDeposit_fundsInOneTx() public {
        // The onboarding-friction fix: deploy + first deposit collapsed into a single signature
        // for the native-MON path, instead of two separate transactions.
        vm.deal(user, 1 ether);
        vm.prank(user);
        address wallet = factory.deployWallet{value: 0.5 ether}(address(0), 0.5 ether);

        assertEq(AccountabilityWallet(payable(wallet)).balanceOf(), 0.5 ether);
        assertEq(user.balance, 0.5 ether);
    }

    function test_deployWallet_revertsOnMismatchedNativeValue() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(ArgusFactory.MismatchedDeposit.selector);
        factory.deployWallet{value: 0.3 ether}(address(0), 0.5 ether);
    }

    function test_deposit_increasesBalance() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));

        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        assertEq(wallet.balanceOf(), 1 ether);
    }

    function test_withdraw_succeedsFromAvailableEvenWithHabitPending() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.SavingsVault);
        habitManager.createHabit(0.3 ether);
        // Not completed today, and never will be — the whole point of the new model is that
        // this no longer blocks withdrawing Available funds.
        vm.stopPrank();

        assertEq(wallet.committedAmount(), 0.3 ether);
        assertEq(wallet.availableBalance(), 0.7 ether);

        uint256 before = user.balance;
        vm.prank(user);
        wallet.withdraw(0.7 ether);

        assertEq(user.balance, before + 0.7 ether);
        assertEq(wallet.balanceOf(), 0.3 ether);
    }

    function test_withdraw_revertsWhenExceedingAvailable() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.SavingsVault);
        habitManager.createHabit(0.4 ether);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.InsufficientBalance.selector);
        wallet.withdraw(0.7 ether); // available is only 0.6 ether
    }

    function test_committedAmount_clampedToBalance() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.SavingsVault);
        habitManager.createHabit(5 ether);
        vm.stopPrank();

        // Configured stake exceeds the actual balance — committedAmount must clamp, not exceed
        // what the vault can cover, and availableBalance must never go negative/underflow.
        assertEq(wallet.committedAmount(), 1 ether);
        assertEq(wallet.availableBalance(), 0);
    }

    function test_committedAmount_sumsEachHabitsOwnStake() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.SavingsVault);
        habitManager.createHabit(0.1 ether); // index 0
        assertEq(wallet.committedAmount(), 0.1 ether);

        habitManager.createHabit(0.15 ether); // index 1 — deliberately a different stake
        assertEq(wallet.committedAmount(), 0.25 ether);

        habitManager.createHabit(0.05 ether); // index 2 — 3 active now (MAX_HABITS)
        assertEq(wallet.committedAmount(), 0.3 ether);

        // Deactivating one frees its own stake from the sum immediately — no separate
        // transaction needed to "release" its share of the commitment.
        habitManager.setHabitActive(1, false);
        assertEq(wallet.committedAmount(), 0.15 ether); // 0.1 + 0.05, index 1's 0.15 excluded
        vm.stopPrank();

        assertEq(wallet.availableBalance(), 0.85 ether);
    }

    function test_committedAmount_unaffectedByLaterConfigurePenaltyOrNewHabits() public {
        // Direct instruction: changing the wallet's penalty type (or creating a new habit with a
        // different stake) must never retroactively change an already-created habit's own
        // locked-in stake or the overall committedAmount contribution it represents.
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 2 ether);
        vm.prank(user);
        wallet.deposit{value: 2 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.SavingsVault);
        habitManager.createHabit(1 ether); // index 0, locked in at 1 ether forever
        assertEq(wallet.committedAmount(), 1 ether);

        // Reconfiguring the wallet-level penalty type (the only thing left in configurePenalty)
        // does not touch index 0's stake.
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.Donate);
        assertEq(wallet.committedAmount(), 1 ether);

        // A second habit with a very different stake doesn't change index 0's contribution —
        // committedAmount grows by exactly the new habit's own stake, not a blanket recompute.
        habitManager.createHabit(0.2 ether);
        assertEq(habitManager.habitStake(user, 0), 1 ether);
        assertEq(wallet.committedAmount(), 1.2 ether);
        vm.stopPrank();
    }

    function test_committedAmount_dropsImmediatelyOnCompletion() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.startPrank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.SavingsVault);
        habitManager.createHabit(0.1 ether); // index 0
        habitManager.createHabit(0.1 ether); // index 1 — 2 active, both still pending today
        vm.stopPrank();

        assertEq(wallet.committedAmount(), 0.2 ether);
        assertEq(wallet.availableBalance(), 0.8 ether);

        // Completing one habit today removes its own stake from the sum immediately — its
        // share becomes withdrawable with no separate transaction, matching committedAmount()'s
        // existing "live view" model.
        vm.prank(verifier);
        habitManager.completeHabit(user, 0);

        assertEq(wallet.committedAmount(), 0.1 ether);
        assertEq(wallet.availableBalance(), 0.9 ether);

        // The still-pending habit (index 1) keeps its own stake committed.
        vm.prank(verifier);
        habitManager.completeHabit(user, 1);

        assertEq(wallet.committedAmount(), 0);
        assertEq(wallet.availableBalance(), 1 ether);
    }

    function test_withdraw_revertsForNonOwner() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(AccountabilityWallet.NotOwner.selector);
        wallet.withdraw(0);
    }

    function test_executePenalty_revertsWhenNotPenaltyEngine() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));

        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.NotPenaltyEngine.selector);
        wallet.executePenalty(0, payable(user));
    }

    function test_moveToSavingsVault_revertsWhenNotPenaltyEngine() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));

        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.NotPenaltyEngine.selector);
        wallet.moveToSavingsVault(0);
    }

    function test_moveToSavingsVault_locksFundsUntilPeriodExpires() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.prank(address(penaltyEngine));
        wallet.moveToSavingsVault(0.4 ether);

        assertEq(wallet.savingsVaultAmount(), 0.4 ether);
        assertEq(wallet.balanceOf(), 1 ether); // funds never physically leave the contract
        assertEq(wallet.availableBalance(), 0.6 ether);

        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.InsufficientBalance.selector);
        wallet.withdraw(0.7 ether); // would dip into the locked savings vault amount

        vm.warp(block.timestamp + penaltyEngine.SAVINGS_VAULT_LOCK_PERIOD() + 1);

        // Once the lock expires, the same funds rejoin availableBalance with no separate
        // "claim" step.
        assertEq(wallet.availableBalance(), 1 ether);
        uint256 before = user.balance;
        vm.prank(user);
        wallet.withdraw(1 ether);
        assertEq(user.balance, before + 1 ether);
    }

    function test_moveToSavingsVault_rollingLockExtendsOnRepeatedMiss() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.prank(address(penaltyEngine));
        wallet.moveToSavingsVault(0.2 ether);
        uint256 firstUnlock = wallet.savingsVaultUnlockAt();

        // Warp partway through the first lock, then miss again — the unlock time should move
        // forward from *now*, not stay pinned to the first miss's timestamp.
        vm.warp(block.timestamp + 1 days);
        vm.prank(address(penaltyEngine));
        wallet.moveToSavingsVault(0.1 ether);

        assertEq(wallet.savingsVaultAmount(), 0.3 ether);
        assertGt(wallet.savingsVaultUnlockAt(), firstUnlock);
    }
}
