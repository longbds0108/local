// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HedgoraEscrow} from "../src/HedgoraEscrow.sol";

/// Usage (from contracts/):
///   source ../apps/web/.env
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast
/// Env:
///   OPERATOR_PRIVATE_KEY  deployer; its address also becomes operator + owner
///   USDC_ADDRESS          USDC ERC-20 interface on Arc testnet (from docs)
contract Deploy is Script {
    function run() external returns (HedgoraEscrow escrow) {
        uint256 pk = vm.envUint("OPERATOR_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address operator = vm.addr(pk);

        vm.startBroadcast(pk);
        escrow = new HedgoraEscrow(IERC20(usdc), operator, operator);
        vm.stopBroadcast();

        console2.log("HedgoraEscrow deployed at:", address(escrow));
        console2.log("operator/owner:", operator);
        console2.log("usdc:", usdc);
    }
}
