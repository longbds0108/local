// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HedgoraEscrow} from "../src/HedgoraEscrow.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract HedgoraEscrowTest is Test {
    MockUSDC usdc;
    HedgoraEscrow escrow;

    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address payer = makeAddr("payer");
    address stranger = makeAddr("stranger");
    address m1 = makeAddr("merchant1");
    address m2 = makeAddr("merchant2");

    bytes32 constant ID = keccak256("itinerary-1");
    uint256 constant A1 = 24e6; // 24 USDC
    uint256 constant A2 = 6e6; // 6 USDC
    uint64 deadline;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new HedgoraEscrow(usdc, operator, owner);
        usdc.mint(payer, 100e6);
        deadline = uint64(block.timestamp + 4 hours);
    }

    function _approve() internal {
        vm.prank(payer);
        usdc.approve(address(escrow), A1 + A2);
    }

    function _depositOnly() internal {
        address[] memory merchants = new address[](2);
        merchants[0] = m1;
        merchants[1] = m2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = A1;
        amounts[1] = A2;
        vm.prank(payer);
        escrow.deposit(ID, merchants, amounts, deadline);
    }

    function _deposit() internal {
        _approve();
        _depositOnly();
    }

    function test_Deposit_TotalMatches() public {
        _approve();
        vm.expectEmit(true, true, false, true);
        emit HedgoraEscrow.Deposited(ID, payer, A1 + A2);
        _depositOnly();

        assertEq(usdc.balanceOf(address(escrow)), A1 + A2);
        assertEq(usdc.balanceOf(payer), 100e6 - A1 - A2);

        (address p, uint64 d, HedgoraEscrow.StopInfo[] memory stops) = escrow.getItinerary(ID);
        assertEq(p, payer);
        assertEq(d, deadline);
        assertEq(stops.length, 2);
        assertEq(stops[0].merchant, m1);
        assertEq(stops[0].amount, A1);
        assertEq(stops[1].amount, A2);
        assertEq(stops[0].status, 0);
    }

    function test_Deposit_RevertsWithoutApproval() public {
        address[] memory merchants = new address[](1);
        merchants[0] = m1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = A1;
        vm.prank(payer);
        vm.expectRevert();
        escrow.deposit(ID, merchants, amounts, deadline);
    }

    function test_Deposit_RevertsOnDuplicateId() public {
        _deposit();
        address[] memory merchants = new address[](1);
        merchants[0] = m1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.startPrank(payer);
        usdc.approve(address(escrow), 1e6);
        vm.expectRevert(HedgoraEscrow.ItineraryExists.selector);
        escrow.deposit(ID, merchants, amounts, deadline);
        vm.stopPrank();
    }

    function test_Deposit_RevertsOnBadInput() public {
        address[] memory merchants = new address[](2);
        merchants[0] = m1;
        merchants[1] = m2;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidInput.selector);
        escrow.deposit(ID, merchants, amounts, deadline);

        uint256[] memory zero = new uint256[](2);
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidInput.selector);
        escrow.deposit(ID, merchants, zero, deadline);
    }

    function test_Deposit_RevertsOnPastDeadline() public {
        address[] memory merchants = new address[](1);
        merchants[0] = m1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.InvalidDeadline.selector);
        escrow.deposit(ID, merchants, amounts, uint64(block.timestamp));
    }

    function test_Release_PaysCorrectMerchant() public {
        _deposit();
        vm.expectEmit(true, false, false, true);
        emit HedgoraEscrow.Released(ID, 1, m2, A2);
        vm.prank(operator);
        escrow.release(ID, 1);

        assertEq(usdc.balanceOf(m2), A2);
        assertEq(usdc.balanceOf(m1), 0);
        assertEq(usdc.balanceOf(address(escrow)), A1);
        (,, HedgoraEscrow.StopInfo[] memory stops) = escrow.getItinerary(ID);
        assertEq(stops[1].status, 1);
    }

    function test_Release_TwiceReverts() public {
        _deposit();
        vm.startPrank(operator);
        escrow.release(ID, 0);
        vm.expectRevert(HedgoraEscrow.StopNotLocked.selector);
        escrow.release(ID, 0);
        vm.stopPrank();
    }

    function test_Release_NonOperatorReverts() public {
        _deposit();
        vm.prank(stranger);
        vm.expectRevert(HedgoraEscrow.NotOperator.selector);
        escrow.release(ID, 0);

        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.NotOperator.selector);
        escrow.release(ID, 0);
    }

    function test_Release_OutOfRangeReverts() public {
        _deposit();
        vm.prank(operator);
        vm.expectRevert(HedgoraEscrow.StopIndexOutOfRange.selector);
        escrow.release(ID, 2);
    }

    function test_Refund_ByPayerBeforeDeadlineReverts() public {
        _deposit();
        vm.prank(payer);
        vm.expectRevert(HedgoraEscrow.DeadlineNotReached.selector);
        escrow.refund(ID, 0);
    }

    function test_Refund_ByPayerAfterDeadline() public {
        _deposit();
        vm.warp(deadline + 1);
        uint256 before = usdc.balanceOf(payer);
        vm.expectEmit(true, false, false, true);
        emit HedgoraEscrow.Refunded(ID, 0, payer, A1);
        vm.prank(payer);
        escrow.refund(ID, 0);
        assertEq(usdc.balanceOf(payer), before + A1);
        (,, HedgoraEscrow.StopInfo[] memory stops) = escrow.getItinerary(ID);
        assertEq(stops[0].status, 2);
    }

    function test_Refund_ByOperatorEarly() public {
        _deposit();
        uint256 before = usdc.balanceOf(payer);
        vm.prank(operator);
        escrow.refund(ID, 1);
        assertEq(usdc.balanceOf(payer), before + A2);
    }

    function test_Refund_StrangerReverts() public {
        _deposit();
        vm.warp(deadline + 1);
        vm.prank(stranger);
        vm.expectRevert(HedgoraEscrow.NotAuthorized.selector);
        escrow.refund(ID, 0);
    }

    function test_Refund_AfterReleaseReverts() public {
        _deposit();
        vm.prank(operator);
        escrow.release(ID, 0);
        vm.prank(operator);
        vm.expectRevert(HedgoraEscrow.StopNotLocked.selector);
        escrow.refund(ID, 0);
    }

    function test_Release_AfterRefundReverts() public {
        _deposit();
        vm.prank(operator);
        escrow.refund(ID, 0);
        vm.prank(operator);
        vm.expectRevert(HedgoraEscrow.StopNotLocked.selector);
        escrow.release(ID, 0);
    }

    function test_Refund_TwiceReverts() public {
        _deposit();
        vm.warp(deadline + 1);
        vm.startPrank(payer);
        escrow.refund(ID, 0);
        vm.expectRevert(HedgoraEscrow.StopNotLocked.selector);
        escrow.refund(ID, 0);
        vm.stopPrank();
    }

    function test_UnknownItineraryReverts() public {
        vm.prank(operator);
        vm.expectRevert(HedgoraEscrow.ItineraryNotFound.selector);
        escrow.release(keccak256("nope"), 0);
    }

    function test_SetOperator_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setOperator(stranger);

        vm.prank(owner);
        escrow.setOperator(stranger);
        assertEq(escrow.operator(), stranger);
    }

    function test_FullFlow_ReleaseOneRefundOther() public {
        _deposit();
        vm.prank(operator);
        escrow.release(ID, 0);
        vm.warp(deadline + 1);
        vm.prank(payer);
        escrow.refund(ID, 1);
        assertEq(usdc.balanceOf(m1), A1);
        assertEq(usdc.balanceOf(payer), 100e6 - A1);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testFuzz_DepositReleaseAll(uint96 a, uint96 b) public {
        vm.assume(a > 0 && b > 0);
        usdc.mint(payer, uint256(a) + uint256(b));
        address[] memory merchants = new address[](2);
        merchants[0] = m1;
        merchants[1] = m2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = a;
        amounts[1] = b;
        vm.startPrank(payer);
        usdc.approve(address(escrow), uint256(a) + uint256(b));
        escrow.deposit(ID, merchants, amounts, deadline);
        vm.stopPrank();
        vm.startPrank(operator);
        escrow.release(ID, 0);
        escrow.release(ID, 1);
        vm.stopPrank();
        assertEq(usdc.balanceOf(m1), a);
        assertEq(usdc.balanceOf(m2), b);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }
}
