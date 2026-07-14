// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IArgusFactory} from "./interfaces/IArgusFactory.sol";
import {IAccountabilityWallet} from "./interfaces/IAccountabilityWallet.sol";

/// @notice Executes the user-chosen consequence when HabitManager settles a missed day.
/// Save = funds simply stay locked (no transfer). Donate/Partner move `penaltyAmount` out of
/// the user's AccountabilityWallet. Surprise resolves to one of the other three at settlement time.
contract PenaltyEngine is Ownable {
    enum PenaltyType {
        Save,
        Donate,
        Partner,
        Surprise
    }

    address public habitManager;
    address public factory;
    address public donationAddress;

    mapping(address => PenaltyType) public penaltyTypeOf;
    mapping(address => address) public partnerOf;
    mapping(address => uint256) public penaltyAmountOf;

    event PenaltyConfigured(address indexed user, PenaltyType penaltyType, address partner, uint256 amount);
    event PenaltyExecuted(address indexed user, PenaltyType resolvedType, address recipient, uint256 amount);
    event PenaltySkipped(address indexed user, string reason);

    error AlreadySet();
    error NotHabitManager();
    error InvalidPartner();
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

    /// @notice Users configure their own consequence and the MON amount at stake per missed day.
    function configurePenalty(PenaltyType penaltyType, address partner, uint256 amount) external {
        if (penaltyType == PenaltyType.Partner && partner == address(0)) revert InvalidPartner();

        penaltyTypeOf[msg.sender] = penaltyType;
        partnerOf[msg.sender] = partner;
        penaltyAmountOf[msg.sender] = amount;

        emit PenaltyConfigured(msg.sender, penaltyType, partner, amount);
    }

    /// @notice Called by HabitManager exactly once per missed day during settlement.
    function execute(address user) external onlyHabitManager {
        uint256 amount = penaltyAmountOf[user];
        if (amount == 0) {
            emit PenaltySkipped(user, "no penalty amount configured");
            return;
        }

        address wallet = IArgusFactory(factory).walletOf(user);
        if (wallet == address(0)) {
            emit PenaltySkipped(user, "no accountability wallet deployed");
            return;
        }

        PenaltyType resolved = _resolve(user);

        if (resolved == PenaltyType.Save) {
            emit PenaltyExecuted(user, resolved, address(0), 0);
            return;
        }

        address recipient = resolved == PenaltyType.Donate ? donationAddress : partnerOf[user];
        if (recipient == address(0)) {
            emit PenaltySkipped(user, "no recipient configured");
            return;
        }

        IAccountabilityWallet(wallet).executePenalty(amount, payable(recipient));
        emit PenaltyExecuted(user, resolved, recipient, amount);
    }

    /// @dev Surprise resolves pseudo-randomly at settlement time. block.prevrandao-based
    /// randomness is manipulable by block producers within a narrow window — acceptable for
    /// a hackathon MVP where the stakes are small self-imposed penalties, not fine for
    /// anything adversarial. Swap for a VRF before mainnet if amounts get meaningful.
    function _resolve(address user) internal view returns (PenaltyType) {
        PenaltyType configured = penaltyTypeOf[user];
        if (configured != PenaltyType.Surprise) return configured;

        uint256 rand = uint256(keccak256(abi.encode(block.prevrandao, block.timestamp, user))) % 3;
        return PenaltyType(rand);
    }
}
