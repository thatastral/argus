// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {AccountabilityWallet} from "../src/AccountabilityWallet.sol";
import {ArgusFactory} from "../src/ArgusFactory.sol";

contract AccountabilityWalletTest is ArgusTestBase {
    address internal user = makeAddr("user");

    function test_deployWallet_ownedByUser() public {
        AccountabilityWallet wallet = deployWalletFor(user);
        assertEq(wallet.owner(), user);
        assertEq(factory.walletOf(user), address(wallet));
    }

    function test_deployWallet_revertsOnSecondCall() public {
        deployWalletFor(user);
        vm.prank(user);
        vm.expectRevert(ArgusFactory.WalletAlreadyDeployed.selector);
        factory.deployWallet();
    }

    function test_deposit_increasesBalance() public {
        AccountabilityWallet wallet = deployWalletFor(user);

        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        assertEq(wallet.balanceOf(), 1 ether);
    }

    function test_withdraw_revertsWhenLocked() public {
        AccountabilityWallet wallet = deployWalletFor(user);
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.prank(user);
        habitManager.createHabit("Code");
        // not completed today -> locked

        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.WalletLocked.selector);
        wallet.withdraw(1 ether);
    }

    function test_withdraw_succeedsWhenUnlocked() public {
        AccountabilityWallet wallet = deployWalletFor(user);
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.prank(user);
        habitManager.createHabit("Code");
        vm.prank(verifier);
        habitManager.completeHabit(user, 0);

        uint256 before = user.balance;
        vm.prank(user);
        wallet.withdraw(0.4 ether);

        assertEq(user.balance, before + 0.4 ether);
        assertEq(wallet.balanceOf(), 0.6 ether);
    }

    function test_withdraw_revertsForNonOwner() public {
        AccountabilityWallet wallet = deployWalletFor(user);
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(AccountabilityWallet.NotOwner.selector);
        wallet.withdraw(0);
    }

    function test_executePenalty_revertsWhenNotPenaltyEngine() public {
        AccountabilityWallet wallet = deployWalletFor(user);

        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.NotPenaltyEngine.selector);
        wallet.executePenalty(0, payable(user));
    }
}
