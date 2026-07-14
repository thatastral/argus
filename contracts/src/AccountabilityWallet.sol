// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHabitManager} from "./interfaces/IHabitManager.sol";

/// @notice Non-custodial per-user vault. Deployed by ArgusFactory, owned entirely by the
/// user's own wallet address. Argus never holds funds or keys — withdrawals are gated by
/// HabitManager's daily unlock state, and only PenaltyEngine may pull funds on a missed day.
contract AccountabilityWallet is ReentrancyGuard {
    address public immutable owner;
    address public immutable habitManager;
    address public immutable penaltyEngine;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PenaltyPaid(address indexed recipient, uint256 amount);

    error NotOwner();
    error NotPenaltyEngine();
    error WalletLocked();
    error InsufficientBalance();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPenaltyEngine() {
        if (msg.sender != penaltyEngine) revert NotPenaltyEngine();
        _;
    }

    constructor(address _owner, address _habitManager, address _penaltyEngine) {
        owner = _owner;
        habitManager = _habitManager;
        penaltyEngine = _penaltyEngine;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw is only allowed once today's active habits are all verified complete.
    function withdraw(uint256 amount) external nonReentrant onlyOwner {
        if (!IHabitManager(habitManager).isUnlockedToday(owner)) revert WalletLocked();
        if (amount > address(this).balance) revert InsufficientBalance();

        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(owner, amount);
    }

    /// @notice Called by PenaltyEngine only, when the owner misses a day's habits.
    function executePenalty(uint256 amount, address payable recipient) external nonReentrant onlyPenaltyEngine {
        if (amount > address(this).balance) revert InsufficientBalance();

        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit PenaltyPaid(recipient, amount);
    }

    function balanceOf() external view returns (uint256) {
        return address(this).balance;
    }
}
