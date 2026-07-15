// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPenaltyEngineExecute} from "./interfaces/IPenaltyEngineExecute.sol";

/// @notice Tracks each user's habit slots, daily proof-of-completion, discipline streak, and
/// unlock eligibility for their AccountabilityWallet. `verifier` is the backend signer that
/// relays Gemini's structured verification result on-chain — AI itself never touches the chain.
///
/// Habit *names* deliberately do not live here — a label is display metadata with no need for
/// trustless enforcement (see Supabase's `habits` table). This contract only tracks the one
/// thing that actually needs to be tamper-proof: whether a given slot is active and whether
/// it's been verified complete on a given day.
contract HabitManager is Ownable {
    uint256 public constant MAX_HABITS = 3;

    address public immutable penaltyEngine;
    address public verifier;
    address public factory;

    mapping(address => uint256) public habitCountOf;
    mapping(address => mapping(uint256 => bool)) public habitActive;
    // user => day => habitIndex => completed
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public completedOn;

    mapping(address => uint256) public currentStreak;
    mapping(address => uint256) public longestStreak;
    mapping(address => uint256) public totalCompletedDays;
    mapping(address => uint256) public totalDaysSettled;

    // First day the user is accountable for, and the next day still owed settlement.
    mapping(address => uint256) public startDay;
    mapping(address => uint256) public nextSettleDay;

    event HabitCreated(address indexed user, uint256 indexed index);
    event HabitActiveSet(address indexed user, uint256 indexed index, bool active);
    event HabitCompleted(address indexed user, uint256 indexed index, uint256 day);
    event DaySettled(address indexed user, uint256 indexed day, bool success, uint256 newStreak);
    event VerifierSet(address verifier);
    event FactorySet(address factory);

    error TooManyHabits();
    error InvalidHabitIndex();
    error NotVerifier();
    error NotFactory();
    error AlreadySet();
    error ZeroAddress();
    error NoHabitsYet();
    error NothingToSettle();

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    constructor(address initialOwner, address _penaltyEngine) Ownable(initialOwner) {
        if (_penaltyEngine == address(0)) revert ZeroAddress();
        penaltyEngine = _penaltyEngine;
    }

    function setVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert ZeroAddress();
        verifier = _verifier;
        emit VerifierSet(_verifier);
    }

    /// @dev One-time wiring, called by owner right after ArgusFactory is deployed.
    function setFactory(address _factory) external onlyOwner {
        if (factory != address(0)) revert AlreadySet();
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
        emit FactorySet(_factory);
    }

    function createHabit() external {
        uint256 count = habitCountOf[msg.sender];
        if (count >= MAX_HABITS) revert TooManyHabits();

        habitActive[msg.sender][count] = true;
        habitCountOf[msg.sender] = count + 1;

        if (count == 0) {
            uint256 today = _today();
            startDay[msg.sender] = today;
            nextSettleDay[msg.sender] = today; // today itself is not owed until tomorrow
        }

        emit HabitCreated(msg.sender, count);
    }

    function setHabitActive(uint256 index, bool active) external {
        if (index >= habitCountOf[msg.sender]) revert InvalidHabitIndex();
        habitActive[msg.sender][index] = active;
        emit HabitActiveSet(msg.sender, index, active);
    }

    function habitCount(address user) external view returns (uint256) {
        return habitCountOf[user];
    }

    /// @notice Called by the backend verifier after Gemini returns verified:true for today's proof.
    function completeHabit(address user, uint256 index) external onlyVerifier {
        if (index >= habitCountOf[user]) revert InvalidHabitIndex();

        uint256 today = _today();
        completedOn[user][today][index] = true;
        emit HabitCompleted(user, index, today);
    }

    /// @notice True once every active habit has been verified complete today.
    /// A user with zero habits is never unlocked.
    function isUnlockedToday(address user) public view returns (bool) {
        return _allActiveCompletedOn(user, _today());
    }

    /// @notice Permissionless keeper function — settles the oldest un-settled day for `user`.
    /// Call repeatedly to catch up if multiple days were missed without anyone calling settle.
    function settle(address user) external {
        if (habitCountOf[user] == 0) revert NoHabitsYet();

        uint256 day = nextSettleDay[user];
        if (day >= _today()) revert NothingToSettle();

        bool success = _allActiveCompletedOn(user, day);

        if (success) {
            uint256 newStreak = currentStreak[user] + 1;
            currentStreak[user] = newStreak;
            if (newStreak > longestStreak[user]) {
                longestStreak[user] = newStreak;
            }
            totalCompletedDays[user] += 1;
        } else {
            currentStreak[user] = 0;
            IPenaltyEngineExecute(penaltyEngine).execute(user);
        }

        totalDaysSettled[user] += 1;
        nextSettleDay[user] = day + 1;

        emit DaySettled(user, day, success, currentStreak[user]);
    }

    function completionRateBps(address user) external view returns (uint256) {
        uint256 settled = totalDaysSettled[user];
        if (settled == 0) return 0;
        return (totalCompletedDays[user] * 10_000) / settled;
    }

    function _allActiveCompletedOn(address user, uint256 day) internal view returns (bool) {
        uint256 len = habitCountOf[user];
        if (len == 0) return false;

        bool hasActive = false;
        for (uint256 i = 0; i < len; i++) {
            if (!habitActive[user][i]) continue;
            hasActive = true;
            if (!completedOn[user][day][i]) return false;
        }
        return hasActive;
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
