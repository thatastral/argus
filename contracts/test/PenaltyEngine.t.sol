// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArgusTestBase} from "./utils/ArgusTestBase.sol";
import {AccountabilityWallet} from "../src/AccountabilityWallet.sol";
import {PenaltyEngine} from "../src/PenaltyEngine.sol";

contract PenaltyEngineTest is ArgusTestBase {
    address internal user = makeAddr("user");
    address internal partner = makeAddr("partner");

    function _setupFailedDay(PenaltyEngine.PenaltyType penaltyType, address partnerAddr, uint256 amount)
        internal
        returns (AccountabilityWallet wallet)
    {
        wallet = deployWalletFor(user);
        vm.deal(user, 1 ether);
        vm.prank(user);
        wallet.deposit{value: 1 ether}();

        vm.prank(user);
        penaltyEngine.configurePenalty(penaltyType, partnerAddr, amount);

        vm.prank(user);
        habitManager.createHabit("Code");
        // never completed -> day fails

        vm.warp(block.timestamp + 1 days);
    }

    function test_save_leavesFundsInWallet() public {
        AccountabilityWallet wallet = _setupFailedDay(PenaltyEngine.PenaltyType.Save, address(0), 0.5 ether);

        habitManager.settle(user);

        assertEq(wallet.balanceOf(), 1 ether);
    }

    function test_donate_movesFundsToDonationAddress() public {
        AccountabilityWallet wallet = _setupFailedDay(PenaltyEngine.PenaltyType.Donate, address(0), 0.3 ether);

        habitManager.settle(user);

        assertEq(wallet.balanceOf(), 0.7 ether);
        assertEq(donationAddress.balance, 0.3 ether);
    }

    function test_partner_movesFundsToPartner() public {
        AccountabilityWallet wallet = _setupFailedDay(PenaltyEngine.PenaltyType.Partner, partner, 0.2 ether);

        habitManager.settle(user);

        assertEq(wallet.balanceOf(), 0.8 ether);
        assertEq(partner.balance, 0.2 ether);
    }

    function test_surprise_resolvesToOneOfThreeAndNeverReverts() public {
        _setupFailedDay(PenaltyEngine.PenaltyType.Surprise, partner, 0.1 ether);

        // Just assert it doesn't revert and totalDaysSettled advances; which concrete
        // type it resolved to is pseudo-random and covered by _resolve's own bound (%3).
        habitManager.settle(user);
        assertEq(habitManager.totalDaysSettled(user), 1);
    }

    function test_execute_revertsWhenNotHabitManager() public {
        vm.expectRevert(PenaltyEngine.NotHabitManager.selector);
        penaltyEngine.execute(user);
    }

    function test_configurePenalty_revertsForPartnerTypeWithoutAddress() public {
        vm.prank(user);
        vm.expectRevert(PenaltyEngine.InvalidPartner.selector);
        penaltyEngine.configurePenalty(PenaltyEngine.PenaltyType.Partner, address(0), 1 ether);
    }
}
