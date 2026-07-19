// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPenaltyEngineView} from "./interfaces/IPenaltyEngineView.sol";
import {IHabitManager} from "./interfaces/IHabitManager.sol";

/// @notice Non-custodial per-user vault. Deployed by ArgusFactory, owned entirely by the
/// user's own wallet address. Argus never holds funds or keys, and the owner's wallet is
/// never locked wholesale — only funds they've explicitly committed are governed.
///
/// Three logical balances. Only `savingsVaultAmount` is actually stored; the other two are
/// live views so they can never drift out of sync with a deposit/withdraw/reconfigure:
/// - **Available** (`availableBalance()`): withdrawable anytime, never gated by habit progress.
/// - **Committed** (`committedAmount()`): the sum of every still-pending-today active habit's
///   own locked-in stake (`HabitManager.pendingStake`, each habit's stake set once at
///   creation — see HabitManager.createHabit), clamped to whatever the vault can actually
///   cover right now — computed fresh on every call rather than stored, so there's no
///   separate "commit" transaction to keep in sync with deposits/withdrawals/creating a habit/
///   a habit being completed for the day.
/// - **Savings Vault** (`savingsVaultAmount`): funds moved here by a missed day (see
///   `moveToSavingsVault`) — still the user's own funds, just locked until
///   `savingsVaultUnlockAt`. A rolling lock: a new miss while already locked extends the
///   unlock time from now rather than tracking independent per-tranche timers.
///
/// `asset` is fixed at deploy time: address(0) means the vault holds native MON, any other
/// address means the vault holds that ERC-20 (e.g. USDC) exclusively. A given vault only
/// ever holds one asset — mixing native and ERC-20 in a single vault would make `balanceOf`
/// and the committed/penalty amount semantics ambiguous.
contract AccountabilityWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public immutable habitManager;
    address public immutable penaltyEngine;
    address public immutable asset;

    uint256 public savingsVaultAmount;
    uint256 public savingsVaultUnlockAt;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PenaltyPaid(address indexed recipient, uint256 amount);
    event MovedToSavingsVault(uint256 amount, uint256 unlockAt);

    error NotOwner();
    error NotPenaltyEngine();
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

    /// @notice Withdraw from the Available balance — never gated by habit progress. Committed
    /// and (while still locked) Savings-Vault funds are excluded automatically by
    /// availableBalance()'s own math, not by a separate boolean check.
    function withdraw(uint256 amount) external nonReentrant onlyOwner {
        if (amount > availableBalance()) revert InsufficientBalance();

        if (asset == address(0)) {
            (bool ok,) = owner.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(owner, amount);
        }

        emit Withdrawn(owner, amount);
    }

    /// @notice Called by PenaltyEngine only, for the Donate consequence.
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

    /// @notice Called by PenaltyEngine only, for the SavingsVault consequence. Funds never
    /// leave this contract — they're just re-earmarked so availableBalance() excludes them
    /// until the lock expires.
    function moveToSavingsVault(uint256 amount) external nonReentrant onlyPenaltyEngine {
        if (amount > balanceOf() - savingsVaultAmount) revert InsufficientBalance();

        savingsVaultAmount += amount;
        savingsVaultUnlockAt = block.timestamp + IPenaltyEngineView(penaltyEngine).SAVINGS_VAULT_LOCK_PERIOD();
        emit MovedToSavingsVault(amount, savingsVaultUnlockAt);
    }

    function balanceOf() public view returns (uint256) {
        return asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
    }

    /// @notice Sum of every still-pending-today active habit's own locked-in stake (see
    /// HabitManager.pendingStake), clamped to what's available to cover it. A live view, not
    /// stored state — see the contract-level doc comment. A completed habit's stake becomes
    /// withdrawable immediately (moves from Committed to Available with no separate transaction,
    /// since Available is just balanceOf() minus this) rather than staying reserved until
    /// midnight — see HabitManager.pendingStake's doc comment for the accepted trade-off this
    /// introduces against a still-unsettled prior miss.
    ///
    /// Summing per-habit stakes (rather than a single wallet-level amount) is deliberate, per a
    /// direct instruction: changing your stake in Settings must never retroactively change what
    /// an already-created habit has at risk, so each habit's own stake — fixed forever at
    /// creation — has to be tracked and summed individually rather than derived from one shared
    /// "current" figure. A single missed day still fails every active habit at once (settle() is
    /// pass/fail per day, not per habit — see HabitManager._allActiveCompletedOn) and
    /// PenaltyEngine.execute() still moves this entire summed figure in one shot. Because
    /// pendingStake can change independently of any deposit/withdraw (a habit completing or a
    /// new one being created), this re-derives itself continuously: e.g. 0.5 ether + 0.3 ether
    /// staked across 2 still-pending habits on a 1.5-ether balance that just moved 0.8 ether into
    /// the Savings Vault immediately re-commits the same 0.8 ether from what's left, so
    /// availableBalance() is 0 until more is deposited — the user stays "at risk" for the rest of
    /// today automatically, without a separate re-commit transaction.
    function committedAmount() public view returns (uint256) {
        uint256 configured = IHabitManager(habitManager).pendingStake(owner);
        uint256 uncommitted = balanceOf() - _lockedSavingsVault();
        return configured > uncommitted ? uncommitted : configured;
    }

    /// @notice Withdrawable right now: everything except what's committed and whatever's
    /// still locked in the Savings Vault. Once the lock expires this reincludes
    /// savingsVaultAmount automatically — no separate "claim" transaction needed.
    function availableBalance() public view returns (uint256) {
        return balanceOf() - committedAmount() - _lockedSavingsVault();
    }

    function _lockedSavingsVault() internal view returns (uint256) {
        return block.timestamp < savingsVaultUnlockAt ? savingsVaultAmount : 0;
    }
}
