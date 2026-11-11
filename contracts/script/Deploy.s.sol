// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HedgoraEscrow} from "../src/HedgoraEscrow.sol";

/// Usage (from contracts/):
///   source ../apps/web/.env
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast
/// Env:
///   OPERATOR_PRIVATE_KEY  deployer; its address also becomes operator + owner.
///                         It only pays gas: it cannot release a stop without the traveller's code,
///                         and refunds can only go to the payer.
contract Deploy is Script {
    function run() external returns (HedgoraEscrow escrow) {
        uint256 pk = vm.envUint("OPERATOR_PRIVATE_KEY");
        address operator = vm.addr(pk);

        vm.startBroadcast(pk);
        escrow = new HedgoraEscrow(operator, operator);
        vm.stopBroadcast();

        console2.log("HedgoraEscrow deployed at:", address(escrow));
        console2.log("operator/owner:", operator);
    }
}
