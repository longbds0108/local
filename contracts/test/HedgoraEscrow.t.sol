// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HedgoraEscrow} from "../src/HedgoraEscrow.sol";

/// A merchant contract that refuses native transfers.
contract Rejecter {
    receive() external payable {
        revert("no");
    }
}

/// Tries to re-enter release() when paid.
contract Reenterer {
    HedgoraEscrow escrow;
    bytes32 id;
    bytes32 code;
    bool tried;

    function arm(HedgoraEscrow e, bytes32 i, bytes32 c) external {
        escrow = e;
        id = i;
        code = c;
    }

    receive() external payable {
        if (!tried) {
            tried = true;
            escrow.release(id, 0, code); // must fail (nonReentrant / not locked)
        }
    }
}

contract HedgoraEscrowTest is Test {
    HedgoraEscrow escrow;

    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address payer = makeAddr("payer");
    address stranger = makeAddr("stranger");
    address m1 = makeAddr("merchant1");
    address m2 = makeAddr("merchant2");

    bytes32 constant ID = keccak256("itinerary-1");
    uint256 constant A1 = 24 ether; // 24 USDC (native, 18 decimals)
    uint256 constant A2 = 6 ether; // 6 USDC
    bytes32 constant C1 = keccak256("secret-code-1");
    bytes32 constant C2 = keccak256("secret-code-2");
    uint64 deadline;

    event Deposited(bytes32 indexed itineraryId, address indexed payer, uint256 total);
    event Released(bytes32 indexed itineraryId, uint256 stopIndex, address merchant, uint256 amount);
    event Refunded(bytes32 indexed itineraryId, uint256 stopIndex, address payer, uint256 amount);

    function setUp() public {
        escrow = new HedgoraEscrow(operator, owner);
        vm.deal(payer, 100 ether);
        deadline = uint64(block.timestamp + 4 hours);
    }

    function _hash(bytes32 code) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(code));
    }

    function _deposit() internal {
        _depositTo(m1, m2);
    }

    function _depositTo(address a, address b) internal {
        address[] memory merchants = new address[](2);
        merchants[0] = a;
        merchants[1] = b;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = A1;
        amounts[1] = A2;
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = _hash(C1);
        hashes[1] = _hash(C2);
        vm.prank(payer);
        escrow.deposit{value: A1 + A2}(ID, merchants, amounts, hashes, deadline);
    }

    // ---------- deposit ----------

    function test_deposit_locksNativeUsdcInOneTransaction() public {
        vm.expectEmit(true, true, false, true);
        emit Deposited(ID, payer, A1 + A2);
        _deposit();

        assertEq(address(escrow).balance, A1 + A2);
        assertEq(payer.balance, 100 ether - A1 - A2);
        (address p, uint64 d, HedgoraEscrow.StopInfo[] memory stops) = escrow.getItinerary(ID);
        assertEq(p, payer);
        assertEq(d, deadline);
        assertEq(stops.length, 2);
        assertEq(stops[0].merchant, m1);
        assertEq(stops[0].amount, A1);
        assertEq(stops[0].codeHash, _hash(C1));
        assertEq(stops[1].status, escrow.STATUS_LOCKED());
    }

    function test_deposit_revertsOnWrongValue() public {
        address[] memory merchants = new address[](1);
        merchants[0] = m1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = A1;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = _hash(C1);
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.WrongAmount.selector);
        escrow.deposit{value: A1 - 1}(ID, merchants, amounts, hashes, deadline);
    }

    function test_deposit_revertsOnDuplicateId() public {
        _deposit();
        vm.expectRevert(HedgoraEscrow.ItineraryExists.selector);
        _deposit();
    }

    function test_deposit_revertsOnMismatchedArrays() public {
        address[] memory merchants = new address[](2);
        merchants[0] = m1;
        merchants[1] = m2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = A1;
        amounts[1] = A2;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = _hash(C1);
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidInput.selector);
        escrow.deposit{value: A1 + A2}(ID, merchants, amounts, hashes, deadline);
    }

    function test_deposit_revertsOnEmptyCodeHash() public {
        address[] memory merchants = new address[](1);
        merchants[0] = m1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = A1;
        bytes32[] memory hashes = new bytes32[](1);
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidInput.selector);
        escrow.deposit{value: A1}(ID, merchants, amounts, hashes, deadline);
    }

    function test_deposit_revertsOnZeroMerchantOrAmount() public {
        address[] memory merchants = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = A1;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = _hash(C1);
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidInput.selector);
        escrow.deposit{value: A1}(ID, merchants, amounts, hashes, deadline);

        merchants[0] = m1;
        amounts[0] = 0;
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidInput.selector);
        escrow.deposit{value: 0}(ID, merchants, amounts, hashes, deadline);
    }

    function test_deposit_revertsOnPastDeadline() public {
        address[] memory merchants = new address[](1);
        merchants[0] = m1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = A1;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = _hash(C1);
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidDeadline.selector);
        escrow.deposit{value: A1}(ID, merchants, amounts, hashes, uint64(block.timestamp));
    }

    // ---------- release (needs the traveller's code) ----------

    function test_release_withCode_paysMerchant_byAnyone() public {
        _deposit();
        vm.expectEmit(true, false, false, true);
        emit Released(ID, 0, m1, A1);
        vm.prank(stranger); // a relayer or the venue itself — caller doesn't matter
        escrow.release(ID, 0, C1);

        assertEq(m1.balance, A1);
        assertEq(address(escrow).balance, A2);
        (,, HedgoraEscrow.StopInfo[] memory stops) = escrow.getItinerary(ID);
        assertEq(stops[0].status, escrow.STATUS_RELEASED());
    }

    function test_release_operatorCannotReleaseWithoutCode() public {
        _deposit();
        vm.prank(operator);
        vm.expectRevert(HedgoraEscrow.WrongCode.selector);
        escrow.release(ID, 0, bytes32(0));
    }

    function test_release_revertsOnWrongCode() public {
        _deposit();
        vm.expectRevert(HedgoraEscrow.WrongCode.selector);
        escrow.release(ID, 0, C2); // code of the other stop
    }

    function test_release_revertsTwice() public {
        _deposit();
        escrow.release(ID, 0, C1);
        vm.expectRevert(HedgoraEscrow.StopNotLocked.selector);
        escrow.release(ID, 0, C1);
    }

    function test_release_revertsAfterDeadline() public {
        _deposit();
        vm.warp(deadline + 1);
        vm.expectRevert(HedgoraEscrow.DeadlinePassed.selector);
        escrow.release(ID, 0, C1);
    }

    function test_release_revertsOnUnknownItineraryOrIndex() public {
        vm.expectRevert(HedgoraEscrow.ItineraryNotFound.selector);
        escrow.release(ID, 0, C1);
        _deposit();
        vm.expectRevert(HedgoraEscrow.StopIndexOutOfRange.selector);
        escrow.release(ID, 2, C1);
    }

    function test_release_revertsWhenMerchantRejectsPayment() public {
        Rejecter r = new Rejecter();
        _depositTo(address(r), m2);
        vm.expectRevert(HedgoraEscrow.TransferFailed.selector);
        escrow.release(ID, 0, C1);
        // Still locked, so it can be refunded later.
        vm.prank(operator);
        escrow.refund(ID, 0);
        assertEq(payer.balance, 100 ether - A2);
    }

    function test_release_cannotBeReentered() public {
        Reenterer r = new Reenterer();
        _depositTo(address(r), m2);
        r.arm(escrow, ID, C1);
        vm.expectRevert(HedgoraEscrow.TransferFailed.selector);
        escrow.release(ID, 0, C1);
    }

    // ---------- refund (only ever to the payer) ----------

    function test_refund_byOperatorAnyTime_paysPayer() public {
        _deposit();
        vm.expectEmit(true, false, false, true);
        emit Refunded(ID, 1, payer, A2);
        vm.prank(operator);
        escrow.refund(ID, 1);
        assertEq(payer.balance, 100 ether - A1);
    }

    function test_refund_byPayerOnlyAfterDeadline() public {
        _deposit();
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.DeadlineNotReached.selector);
        escrow.refund(ID, 0);

        vm.warp(deadline + 1);
        vm.prank(payer);
        escrow.refund(ID, 0);
        assertEq(payer.balance, 100 ether - A2);
    }

    function test_refund_revertsForStranger() public {
        _deposit();
        vm.warp(deadline + 1);
        vm.prank(stranger);
        vm.expectRevert(HedgoraEscrow.NotAuthorized.selector);
        escrow.refund(ID, 0);
    }

    function test_refund_revertsAfterRelease() public {
        _deposit();
        escrow.release(ID, 0, C1);
        vm.prank(operator);
        vm.expectRevert(HedgoraEscrow.StopNotLocked.selector);
        escrow.refund(ID, 0);
    }

    function test_release_revertsAfterRefund() public {
        _deposit();
        vm.prank(operator);
        escrow.refund(ID, 0);
        vm.expectRevert(HedgoraEscrow.StopNotLocked.selector);
        escrow.release(ID, 0, C1);
    }

    function test_mixedOutcome_conservesFunds() public {
        _deposit();
        escrow.release(ID, 0, C1);
        vm.warp(deadline + 1);
        vm.prank(payer);
        escrow.refund(ID, 1);
        assertEq(m1.balance, A1);
        assertEq(payer.balance, 100 ether - A1);
        assertEq(address(escrow).balance, 0);
    }

    // ---------- admin ----------

    function test_setOperator_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setOperator(stranger);

        vm.prank(owner);
        escrow.setOperator(stranger);
        assertEq(escrow.operator(), stranger);
    }

    function test_setOperator_revertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(HedgoraEscrow.InvalidInput.selector);
        escrow.setOperator(address(0));
    }

    function testFuzz_onlyTheRightCodeReleases(bytes32 guess) public {
        vm.assume(guess != C1);
        _deposit();
        vm.expectRevert(HedgoraEscrow.WrongCode.selector);
        escrow.release(ID, 0, guess);
    }
}
