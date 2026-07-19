// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HabitManager} from "../../src/HabitManager.sol";
import {PenaltyEngine} from "../../src/PenaltyEngine.sol";
import {ArgusFactory} from "../../src/ArgusFactory.sol";
import {AccountabilityWallet} from "../../src/AccountabilityWallet.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

/// @dev Wires the same PenaltyEngine -> HabitManager -> ArgusFactory bootstrap sequence used
/// by script/Deploy.s.sol, so tests exercise the exact deployment topology production uses.
abstract contract ArgusTestBase is Test {
    address internal deployer = makeAddr("deployer");
    address internal verifier = makeAddr("verifier");
    address internal donationAddress = makeAddr("donation");

    HabitManager internal habitManager;
    PenaltyEngine internal penaltyEngine;
    ArgusFactory internal factory;
    MockUSDC internal usdc;

    function setUp() public virtual {
        vm.startPrank(deployer);

        penaltyEngine = new PenaltyEngine(deployer, donationAddress);
        habitManager = new HabitManager(deployer, address(penaltyEngine));
        penaltyEngine.setHabitManager(address(habitManager));

        factory = new ArgusFactory(address(habitManager), address(penaltyEngine));
        habitManager.setFactory(address(factory));
        penaltyEngine.setFactory(address(factory));

        habitManager.setVerifier(verifier);
        usdc = new MockUSDC();

        vm.stopPrank();
    }

    /// @param asset address(0) for a native-MON vault, or an ERC-20 address (e.g. `usdc`).
    function deployWalletFor(address user, address asset) internal returns (AccountabilityWallet wallet) {
        vm.prank(user);
        wallet = AccountabilityWallet(payable(factory.deployWallet(asset, 0)));
    }
}
