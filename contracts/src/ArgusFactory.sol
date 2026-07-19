// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccountabilityWallet} from "./AccountabilityWallet.sol";

/// @notice Deploys one AccountabilityWallet per user, owned entirely by that user's address.
/// Argus (and this factory) never takes custody of funds or private keys — this contract only
/// records which vault belongs to which user so HabitManager/PenaltyEngine can find it.
contract ArgusFactory {
    using SafeERC20 for IERC20;

    address public immutable habitManager;
    address public immutable penaltyEngine;

    mapping(address => address) public walletOf;

    event WalletDeployed(address indexed user, address indexed wallet, address asset);

    error WalletAlreadyDeployed();
    error MismatchedDeposit();

    constructor(address _habitManager, address _penaltyEngine) {
        habitManager = _habitManager;
        penaltyEngine = _penaltyEngine;
    }

    /// @param asset address(0) for a native-MON vault, or an ERC-20 token address (e.g. USDC)
    /// for a vault denominated in that token. Fixed for the lifetime of the deployed vault.
    /// @param initialDeposit Optional — fold the vault's first deposit into this same
    /// transaction, per a direct instruction to cut onboarding down from separate
    /// deploy-then-deposit signatures to one. Pass 0 to deploy with nothing deposited yet,
    /// unchanged from the original behavior. For a native vault, `msg.value` must equal this
    /// exactly; for an ERC-20 vault, the caller must have `approve()`d *this factory* (not the
    /// not-yet-deployed wallet address, which isn't known in advance without CREATE2) for at
    /// least `initialDeposit` beforehand. Either path calls straight into the new wallet's own
    /// deposit()/depositERC20() rather than duplicating that logic here, so it emits the exact
    /// same Deposited event a normal deposit would.
    function deployWallet(address asset, uint256 initialDeposit) external payable returns (address wallet) {
        if (walletOf[msg.sender] != address(0)) revert WalletAlreadyDeployed();

        AccountabilityWallet newWallet = new AccountabilityWallet(msg.sender, habitManager, penaltyEngine, asset);
        wallet = address(newWallet);
        walletOf[msg.sender] = wallet;

        emit WalletDeployed(msg.sender, wallet, asset);

        if (asset == address(0)) {
            if (msg.value != initialDeposit) revert MismatchedDeposit();
            if (initialDeposit > 0) newWallet.deposit{value: initialDeposit}();
        } else {
            if (msg.value != 0) revert MismatchedDeposit();
            if (initialDeposit > 0) {
                // Pull to this factory first, then approve+deposit into the wallet — routes
                // through depositERC20() itself (rather than transferring straight to the
                // wallet) purely so the wallet's own Deposited event still fires normally.
                IERC20(asset).safeTransferFrom(msg.sender, address(this), initialDeposit);
                IERC20(asset).forceApprove(wallet, initialDeposit);
                newWallet.depositERC20(initialDeposit);
            }
        }
    }
}
