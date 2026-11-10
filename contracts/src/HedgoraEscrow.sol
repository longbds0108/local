// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HedgoraEscrow
/// @notice Holds USDC (ERC-20 interface, 6 decimals) for a travel itinerary, split per stop.
///         The operator (Hedgora backend) releases a stop to its merchant after a valid QR check-in.
///         Unreleased stops can be refunded to the payer: by the payer after the deadline,
///         or by the operator at any time (e.g. the user cancelled that stop).
contract HedgoraEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint8 public constant STATUS_LOCKED = 0;
    uint8 public constant STATUS_RELEASED = 1;
    uint8 public constant STATUS_REFUNDED = 2;

    struct StopInfo {
        address merchant;
        uint256 amount;
        uint8 status; // 0=Locked 1=Released 2=Refunded
    }

    struct Itinerary {
        address payer;
        uint64 deadline;
        StopInfo[] stops;
    }

    IERC20 public immutable usdc;
    address public operator;

    mapping(bytes32 => Itinerary) private _itineraries;

    event Deposited(bytes32 indexed itineraryId, address indexed payer, uint256 total);
    event Released(bytes32 indexed itineraryId, uint256 stopIndex, address merchant, uint256 amount);
    event Refunded(bytes32 indexed itineraryId, uint256 stopIndex, address payer, uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);

    error NotOperator();
    error NotAuthorized();
    error ItineraryExists();
    error ItineraryNotFound();
    error InvalidInput();
    error InvalidDeadline();
    error StopIndexOutOfRange();
    error StopNotLocked();
    error DeadlineNotReached();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IERC20 usdc_, address operator_, address owner_) Ownable(owner_) {
        if (address(usdc_) == address(0) || operator_ == address(0)) revert InvalidInput();
        usdc = usdc_;
        operator = operator_;
        emit OperatorChanged(address(0), operator_);
    }

    /// @notice Lock USDC for an itinerary. The payer must `approve` this contract for sum(amounts) first.
    function deposit(
        bytes32 itineraryId,
        address[] calldata merchants,
        uint256[] calldata amounts,
        uint64 deadline
    ) external nonReentrant {
        if (_itineraries[itineraryId].payer != address(0)) revert ItineraryExists();
        uint256 n = merchants.length;
        if (n == 0 || n != amounts.length) revert InvalidInput();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        Itinerary storage it = _itineraries[itineraryId];
        it.payer = msg.sender;
        it.deadline = deadline;

        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (merchants[i] == address(0) || amounts[i] == 0) revert InvalidInput();
            it.stops.push(StopInfo({merchant: merchants[i], amount: amounts[i], status: STATUS_LOCKED}));
            total += amounts[i];
        }

        usdc.safeTransferFrom(msg.sender, address(this), total);
        emit Deposited(itineraryId, msg.sender, total);
    }

    /// @notice Pay a stop's merchant after a verified check-in.
    function release(bytes32 itineraryId, uint256 stopIndex) external onlyOperator nonReentrant {
        StopInfo storage s = _lockedStop(itineraryId, stopIndex);
        s.status = STATUS_RELEASED;
        usdc.safeTransfer(s.merchant, s.amount);
        emit Released(itineraryId, stopIndex, s.merchant, s.amount);
    }

    /// @notice Return a stop's funds to the payer.
    ///         Payer: only after the deadline. Operator: any time (user-initiated cancellation).
    function refund(bytes32 itineraryId, uint256 stopIndex) external nonReentrant {
        Itinerary storage it = _itineraries[itineraryId];
        if (it.payer == address(0)) revert ItineraryNotFound();
        if (msg.sender == it.payer) {
            if (block.timestamp <= it.deadline) revert DeadlineNotReached();
        } else if (msg.sender != operator) {
            revert NotAuthorized();
        }

        StopInfo storage s = _lockedStop(itineraryId, stopIndex);
        s.status = STATUS_REFUNDED;
        usdc.safeTransfer(it.payer, s.amount);
        emit Refunded(itineraryId, stopIndex, it.payer, s.amount);
    }

    function getItinerary(bytes32 itineraryId)
        external
        view
        returns (address payer, uint64 deadline, StopInfo[] memory stops)
    {
        Itinerary storage it = _itineraries[itineraryId];
        return (it.payer, it.deadline, it.stops);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidInput();
        emit OperatorChanged(operator, newOperator);
        operator = newOperator;
    }

    function _lockedStop(bytes32 itineraryId, uint256 stopIndex) private view returns (StopInfo storage s) {
        Itinerary storage it = _itineraries[itineraryId];
        if (it.payer == address(0)) revert ItineraryNotFound();
        if (stopIndex >= it.stops.length) revert StopIndexOutOfRange();
        s = it.stops[stopIndex];
        if (s.status != STATUS_LOCKED) revert StopNotLocked();
    }
}
