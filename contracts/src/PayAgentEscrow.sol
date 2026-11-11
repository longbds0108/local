// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PayAgentEscrow (v2)
/// @notice Per-stop escrow for a travel itinerary, paid in Arc's native USDC (msg.value, 18 decimals),
///         so paying is a single transaction — no ERC-20 approve step.
///
///         Trust model — where money can go:
///         - A stop's money can only ever go to the merchant fixed at deposit, or back to the payer.
///         - Releasing to the merchant needs the stop's check-in code: a random secret created on the
///           traveller's device; only its hash is stored here. The traveller hands it over by showing
///           the QR code at the venue. Anyone may submit it (the venue, or a gas-paying relayer), but
///           nobody — the PAY AGENT operator included — can release a stop without it.
///         - Unreleased stops go back to the payer: by the payer after the deadline, or by the operator
///           at any time (a traveller-requested cancellation). A refund can only pay the payer.
contract PayAgentEscrow is ReentrancyGuard, Ownable {
    uint8 public constant STATUS_LOCKED = 0;
    uint8 public constant STATUS_RELEASED = 1;
    uint8 public constant STATUS_REFUNDED = 2;

    struct StopInfo {
        address merchant;
        uint256 amount; // native USDC, 18 decimals
        bytes32 codeHash; // keccak256(abi.encodePacked(code))
        uint8 status; // 0=Locked 1=Released 2=Refunded
    }

    struct Itinerary {
        address payer;
        uint64 deadline;
        StopInfo[] stops;
    }

    address public operator;

    mapping(bytes32 => Itinerary) private _itineraries;

    event Deposited(bytes32 indexed itineraryId, address indexed payer, uint256 total);
    event Released(bytes32 indexed itineraryId, uint256 stopIndex, address merchant, uint256 amount);
    event Refunded(bytes32 indexed itineraryId, uint256 stopIndex, address payer, uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);

    error NotAuthorized();
    error ItineraryExists();
    error ItineraryNotFound();
    error InvalidInput();
    error InvalidDeadline();
    error WrongAmount();
    error StopIndexOutOfRange();
    error StopNotLocked();
    error WrongCode();
    error DeadlinePassed();
    error DeadlineNotReached();
    error TransferFailed();

    constructor(address operator_, address owner_) Ownable(owner_) {
        if (operator_ == address(0)) revert InvalidInput();
        operator = operator_;
        emit OperatorChanged(address(0), operator_);
    }

    /// @notice Lock native USDC for an itinerary. msg.value must equal sum(amounts).
    /// @param codeHashes keccak256 of each stop's check-in code (codes stay on the traveller's device).
    function deposit(
        bytes32 itineraryId,
        address[] calldata merchants,
        uint256[] calldata amounts,
        bytes32[] calldata codeHashes,
        uint64 deadline
    ) external payable nonReentrant {
        if (_itineraries[itineraryId].payer != address(0)) revert ItineraryExists();
        uint256 n = merchants.length;
        if (n == 0 || n != amounts.length || n != codeHashes.length) revert InvalidInput();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        Itinerary storage it = _itineraries[itineraryId];
        it.payer = msg.sender;
        it.deadline = deadline;

        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (merchants[i] == address(0) || amounts[i] == 0 || codeHashes[i] == bytes32(0)) revert InvalidInput();
            it.stops.push(StopInfo({merchant: merchants[i], amount: amounts[i], codeHash: codeHashes[i], status: STATUS_LOCKED}));
            total += amounts[i];
        }
        if (msg.value != total) revert WrongAmount();

        emit Deposited(itineraryId, msg.sender, total);
    }

    /// @notice Pay a stop to its merchant. Needs the stop's check-in code from the traveller's QR.
    ///         Callable by anyone; the money can only go to the merchant fixed at deposit.
    function release(bytes32 itineraryId, uint256 stopIndex, bytes32 code) external nonReentrant {
        Itinerary storage it = _itineraries[itineraryId];
        StopInfo storage s = _lockedStop(itineraryId, stopIndex);
        if (block.timestamp > it.deadline) revert DeadlinePassed();
        if (keccak256(abi.encodePacked(code)) != s.codeHash) revert WrongCode();

        s.status = STATUS_RELEASED;
        _send(s.merchant, s.amount);
        emit Released(itineraryId, stopIndex, s.merchant, s.amount);
    }

    /// @notice Return a stop's money to the payer.
    ///         Payer: only after the deadline. Operator: any time (traveller-requested cancellation).
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
        _send(it.payer, s.amount);
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

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
