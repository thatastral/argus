// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {AccountabilityWallet} from "../src/AccountabilityWallet.sol";
import {PenaltyEngine} from "../src/PenaltyEngine.sol";

contract AccountabilityWalletERC20Test is ArgusTestBase {
    address internal user = makeAddr("user");

    function _depositUsdc(AccountabilityWallet wallet, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(address(wallet), amount);
        vm.prank(user);
        wallet.depositERC20(amount);
    }

    function test_deployWallet_withUsdcAsset() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(usdc));
        assertEq(wallet.asset(), address(usdc));
    }

    function test_depositERC20_increasesBalance() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(usdc));
        _depositUsdc(wallet, 100e6);

        assertEq(wallet.balanceOf(), 100e6);
        assertEq(usdc.balanceOf(address(wallet)), 100e6);
    }

    function test_deposit_revertsOnUsdcWallet() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(usdc));

        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.WrongAssetPath.selector);
        wallet.deposit{value: 1 ether}();
    }

    function test_depositERC20_revertsOnNativeWallet() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(0));

        vm.prank(user);
        vm.expectRevert(AccountabilityWallet.WrongAssetPath.selector);
        wallet.depositERC20(100e6);
    }

    function test_withdraw_movesUsdcNotEth() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(usdc));
        _depositUsdc(wallet, 100e6);

        vm.prank(user);
        habitManager.createHabit();
        vm.prank(verifier);
        habitManager.completeHabit(user, 0);

        vm.prank(user);
        wallet.withdraw(40e6);

        assertEq(usdc.balanceOf(user), 40e6);
        assertEq(wallet.balanceOf(), 60e6);
    }

    function test_executePenalty_movesUsdc() public {
        AccountabilityWallet wallet = deployWalletFor(user, address(usdc));
        _depositUsdc(wallet, 100e6);

        vm.prank(user);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.Donate, address(0), 25e6);

        vm.prank(user);
        habitManager.createHabit();
        // never completed -> day fails

        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(wallet.balanceOf(), 75e6);
        assertEq(usdc.balanceOf(donationAddress), 25e6);
    }
}
