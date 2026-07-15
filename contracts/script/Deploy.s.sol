// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {HabitManager} from "../src/HabitManager.sol";
import {PenaltyEngine} from "../src/PenaltyEngine.sol";
import {ArgusFactory} from "../src/ArgusFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Deploys and wires PenaltyEngine -> HabitManager -> ArgusFactory in the only order
/// that avoids a constructor cycle (see contracts/README for the full explanation).
///
/// Usage (testnet, also deploys MockUSDC so vaults can be denominated in it):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url monad_testnet --broadcast \
///     --sig "run(address,address,bool)" <VERIFIER_ADDRESS> <DONATION_ADDRESS> true
///
/// Usage (mainnet — never deploy MockUSDC there, pass real USDC's address to the frontend instead):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url monad_mainnet --broadcast \
///     --sig "run(address,address,bool)" <VERIFIER_ADDRESS> <DONATION_ADDRESS> false
contract Deploy is Script {
    function run(address verifier, address donationAddress, bool deployMockUsdc) external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        PenaltyEngine penaltyEngine = new PenaltyEngine(deployer, donationAddress);
        HabitManager habitManager = new HabitManager(deployer, address(penaltyEngine));
        penaltyEngine.setHabitManager(address(habitManager));

        ArgusFactory factory = new ArgusFactory(address(habitManager), address(penaltyEngine));
        habitManager.setFactory(address(factory));
        penaltyEngine.setFactory(address(factory));

        habitManager.setVerifier(verifier);

        MockUSDC usdc;
        if (deployMockUsdc) {
            usdc = new MockUSDC();
        }

        vm.stopBroadcast();

        console.log("PenaltyEngine:", address(penaltyEngine));
        console.log("HabitManager:", address(habitManager));
        console.log("ArgusFactory:", address(factory));
        if (deployMockUsdc) {
            console.log("MockUSDC:", address(usdc));
        }
    }
}
