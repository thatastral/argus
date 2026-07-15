// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IHabitManager} from "./interfaces/IHabitManager.sol";

/// @notice Non-custodial per-user vault. Deployed by ArgusFactory, owned entirely by the
/// user's own wallet address. Argus never holds funds or keys — withdrawals are gated by
/// HabitManager's daily unlock state, and only PenaltyEngine may pull funds on a missed day.
///
/// `asset` is fixed at deploy time: address(0) means the vault holds native MON, any other
/// address means the vault holds that ERC-20 (e.g. USDC) exclusively. A given vault only
/// ever holds one asset — mixing native and ERC-20 in a single vault would make `balanceOf`
/// and the unlock/penalty amount semantics ambiguous.
contract AccountabilityWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public immutable habitManager;
    address public immutable penaltyEngine;
    address public immutable asset;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PenaltyPaid(address indexed recipient, uint256 amount);

    error NotOwner();
    error NotPenaltyEngine();
    error WalletLocked();
    error InsufficientBalance();
    error TransferFailed();
    error WrongAssetPath();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPenaltyEngine() {
        if (msg.sender != penaltyEngine) revert NotPenaltyEngine();
        _;
    }

    constructor(address _owner, address _habitManager, address _penaltyEngine, address _asset) {
        owner = _owner;
        habitManager = _habitManager;
        penaltyEngine = _penaltyEngine;
        asset = _asset;
    }

    receive() external payable {
        if (asset != address(0)) revert WrongAssetPath();
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Deposit native MON. Reverts if this vault's asset is an ERC-20 — use depositERC20 instead.
    function deposit() external payable {
        if (asset != address(0)) revert WrongAssetPath();
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Deposit this vault's ERC-20 asset. Caller must approve() this contract for
    /// at least `amount` first. Reverts if this vault's asset is native MON.
    function depositERC20(uint256 amount) external {
        if (asset == address(0)) revert WrongAssetPath();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw is only allowed once today's active habits are all verified complete.
    function withdraw(uint256 amount) external nonReentrant onlyOwner {
        if (!IHabitManager(habitManager).isUnlockedToday(owner)) revert WalletLocked();
        if (amount > balanceOf()) revert InsufficientBalance();

        if (asset == address(0)) {
            (bool ok,) = owner.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(owner, amount);
        }

        emit Withdrawn(owner, amount);
    }

    /// @notice Called by PenaltyEngine only, when the owner misses a day's habits.
    function executePenalty(uint256 amount, address payable recipient) external nonReentrant onlyPenaltyEngine {
        if (amount > balanceOf()) revert InsufficientBalance();

        if (asset == address(0)) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }

        emit PenaltyPaid(recipient, amount);
    }

    function balanceOf() public view returns (uint256) {
        return asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
    }
}
