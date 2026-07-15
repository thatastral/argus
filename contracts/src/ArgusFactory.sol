// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccountabilityWallet} from "./AccountabilityWallet.sol";

/// @notice Deploys one AccountabilityWallet per user, owned entirely by that user's address.
/// Argus (and this factory) never takes custody of funds or private keys — this contract only
/// records which vault belongs to which user so HabitManager/PenaltyEngine can find it.
contract ArgusFactory {
    address public immutable habitManager;
    address public immutable penaltyEngine;

    mapping(address => address) public walletOf;

    event WalletDeployed(address indexed user, address indexed wallet, address asset);

    error WalletAlreadyDeployed();

    constructor(address _habitManager, address _penaltyEngine) {
        habitManager = _habitManager;
        penaltyEngine = _penaltyEngine;
    }

    /// @param asset address(0) for a native-MON vault, or an ERC-20 token address (e.g. USDC)
    /// for a vault denominated in that token. Fixed for the lifetime of the deployed vault.
    function deployWallet(address asset) external returns (address wallet) {
        if (walletOf[msg.sender] != address(0)) revert WalletAlreadyDeployed();

        wallet = address(new AccountabilityWallet(msg.sender, habitManager, penaltyEngine, asset));
        walletOf[msg.sender] = wallet;

        emit WalletDeployed(msg.sender, wallet, asset);
    }
}
