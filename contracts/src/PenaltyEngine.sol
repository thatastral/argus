// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IArgusFactory} from "./interfaces/IArgusFactory.sol";
import {IAccountabilityWallet} from "./interfaces/IAccountabilityWallet.sol";

/// @notice Executes the user-chosen consequence when HabitManager settles a missed day.
/// SavingsVault moves the wallet's currently-committed amount into its own locked
/// savings-vault bucket (see AccountabilityWallet.moveToSavingsVault) — still the user's
/// funds, just locked for SAVINGS_VAULT_LOCK_PERIOD. Donate transfers the committed amount
/// out to donationAddress immediately. `amount` is always read fresh from the wallet's own
/// committedAmount() view (not stored here) so it's automatically clamped to whatever the
/// vault can actually cover — see AccountabilityWallet.sol's doc comment on why committed is
/// a live view rather than mutable state kept in sync by hand.
///
/// Only tracks *type* now (SavingsVault vs Donate), a single wallet-level choice applying
/// uniformly to any day's failure. The per-habit stake amount this used to also store here
/// (`penaltyAmountOf`) moved to HabitManager.habitStake — each habit locks in its own stake at
/// creation, so there is no more single "amount" for a whole wallet to configure.
contract PenaltyEngine is Ownable {
    enum PenaltyType {
        SavingsVault,
        Donate
    }

    /// @dev Not specified by product doc — 7 days chosen as a sensible MVP default, easy to
    /// change before a real deploy.
    uint256 public constant SAVINGS_VAULT_LOCK_PERIOD = 7 days;

    address public habitManager;
    address public factory;
    address public donationAddress;

    mapping(address => PenaltyType) public penaltyTypeOf;

    event PenaltyConfigured(address indexed user, PenaltyType penaltyType);
    event PenaltyExecuted(address indexed user, PenaltyType resolvedType, address recipient, uint256 amount);
    event PenaltySkipped(address indexed user, string reason);

    error AlreadySet();
    error NotHabitManager();
    error ZeroAddress();

    modifier onlyHabitManager() {
        if (msg.sender != habitManager) revert NotHabitManager();
        _;
    }

    constructor(address initialOwner, address _donationAddress) Ownable(initialOwner) {
        if (_donationAddress == address(0)) revert ZeroAddress();
        donationAddress = _donationAddress;
    }

    /// @dev One-time wiring, called by owner right after HabitManager is deployed.
    function setHabitManager(address _habitManager) external onlyOwner {
        if (habitManager != address(0)) revert AlreadySet();
        if (_habitManager == address(0)) revert ZeroAddress();
        habitManager = _habitManager;
    }

    /// @dev One-time wiring, called by owner right after ArgusFactory is deployed.
    function setFactory(address _factory) external onlyOwner {
        if (factory != address(0)) revert AlreadySet();
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
    }

    function setDonationAddress(address _donationAddress) external onlyOwner {
        if (_donationAddress == address(0)) revert ZeroAddress();
        donationAddress = _donationAddress;
    }

    /// @notice Users configure their own consequence for a missed day — Savings Vault or Donate.
    /// The amount at stake is no longer configured here; see HabitManager.createHabit's
    /// stakeAmount, locked in per-habit.
    function configurePenalty(PenaltyType penaltyType) external {
        penaltyTypeOf[msg.sender] = penaltyType;

        emit PenaltyConfigured(msg.sender, penaltyType);
    }

    /// @notice Called by HabitManager exactly once per missed day during settlement.
    function execute(address user) external onlyHabitManager {
        address wallet = IArgusFactory(factory).walletOf(user);
        if (wallet == address(0)) {
            emit PenaltySkipped(user, "no accountability wallet deployed");
            return;
        }

        uint256 amount = IAccountabilityWallet(wallet).committedAmount();
        if (amount == 0) {
            emit PenaltySkipped(user, "no committed amount");
            return;
        }

        PenaltyType penaltyType = penaltyTypeOf[user];

        if (penaltyType == PenaltyType.SavingsVault) {
            IAccountabilityWallet(wallet).moveToSavingsVault(amount);
            emit PenaltyExecuted(user, penaltyType, address(0), amount);
            return;
        }

        IAccountabilityWallet(wallet).executePenalty(amount, payable(donationAddress));
        emit PenaltyExecuted(user, penaltyType, donationAddress, amount);
    }
}
