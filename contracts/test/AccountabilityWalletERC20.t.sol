// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {AccountabilityWallet} from "../src/AccountabilityWallet.sol";
import {ArgusFactory} from "../src/ArgusFactory.sol";
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

    function test_deployWallet_withInitialUsdcDeposit_fundsInOneTx() public {
        // The onboarding-friction fix on the ERC-20 path: still needs its own approve() (an
        // ERC-20 allowance can't be skipped), but targets *this factory* instead of a
        // not-yet-deployed wallet address, then folds deploy + deposit into the second
        // transaction — two signatures total instead of three (deploy, approve, deposit).
        usdc.mint(user, 100e6);
        vm.prank(user);
        usdc.approve(address(factory), 100e6);

        vm.prank(user);
        address wallet = factory.deployWallet(address(usdc), 100e6);

        assertEq(AccountabilityWallet(payable(wallet)).balanceOf(), 100e6);
        assertEq(usdc.balanceOf(user), 0);
    }

    function test_deployWallet_revertsOnStrayNativeValueForErc20Vault() public {
        usdc.mint(user, 100e6);
        vm.prank(user);
        usdc.approve(address(factory), 100e6);

        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(ArgusFactory.MismatchedDeposit.selector);
        factory.deployWallet{value: 0.1 ether}(address(usdc), 100e6);
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
        habitManager.createHabit(10e6);
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
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.Donate);

        vm.prank(user);
        habitManager.createHabit(25e6);
        // never completed -> day fails

        vm.warp(block.timestamp + 1 days);
        habitManager.settle(user);

        assertEq(wallet.balanceOf(), 75e6);
        assertEq(usdc.balanceOf(donationAddress), 25e6);
    }
}
