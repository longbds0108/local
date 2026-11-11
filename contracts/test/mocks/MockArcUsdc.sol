// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// LOCAL TESTING ONLY. Stands in for Arc's USDC ERC-20 interface (0x3600…0000) on Anvil:
/// a 6-decimal `transfer` that moves native value (18 decimals) and emits the standard
/// Transfer event — the event Hedgora reads to confirm a pay-at-venue payment.
/// Put it at the Arc address with `anvil_setCode`, then fund a sender with `deposit()`.
contract MockArcUsdc {
    event Transfer(address indexed from, address indexed to, uint256 value);

    mapping(address => uint256) public balanceOf; // 6 decimals

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value / 1e12;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "balance");
        balanceOf[msg.sender] -= value;
        (bool ok,) = to.call{value: value * 1e12}("");
        require(ok, "send");
        emit Transfer(msg.sender, to, value);
        return true;
    }
}
