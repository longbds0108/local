import { NextResponse } from "next/server";
import { getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { currentBlock, nativeUsdcWei, usdcErc20 } from "@/lib/chain";
import { createContractExecutionChallenge, getArcWallet } from "@/lib/circle";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  to: z.string().refine((a) => isAddress(a), "invalid address"),
  amount: z.string().regex(/^\d{1,7}(\.\d{1,6})?$/),
});

/**
 * Send USDC from the signed-in wallet to any address: ONE Circle challenge for a
 * USDC transfer that the user confirms with their PIN in Circle's window. The
 * sender comes from Circle (never the client). Confirmed afterwards from the
 * chain by /api/wallet/transfer.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`wallet-send:${clientIp(req)}`, 10, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const body = await parseJson(req, Body);
  const value = parseUnits(body.amount, 6);
  if (value <= 0n) throw new ApiError(400, "BAD_REQUEST", "Enter an amount");

  const wallet = await getArcWallet(body.userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Create your wallet first");
  const from = getAddress(wallet.address);
  const to = getAddress(body.to);
  if (to === from) throw new ApiError(400, "BAD_REQUEST", "You can't send to your own wallet");
  // USDC sent to a contract that can't hand it back is lost for good.
  const contracts = [zeroAddress, usdcErc20(), process.env.ESCROW_ADDRESS?.trim()].filter(Boolean).map((a) => getAddress(a as string));
  if (contracts.includes(to)) throw new ApiError(400, "BAD_REQUEST", "This address can't receive a transfer");

  const balance = await nativeUsdcWei(from as Address);
  if (balance < value * 10n ** 12n) {
    throw new ApiError(402, "INSUFFICIENT_USDC", "Not enough USDC in the wallet — get testnet USDC from the faucet");
  }

  // Where to start looking for the transfer once it's signed.
  const block = await currentBlock();
  const { challengeId } = await createContractExecutionChallenge({
    userToken: body.userToken,
    walletId: wallet.id,
    contractAddress: usdcErc20(),
    abiFunctionSignature: "transfer(address,uint256)",
    abiParameters: [to, value.toString()],
  });
  return NextResponse.json({ challengeId, from, to, fromBlock: (block > 5n ? block - 5n : 0n).toString() });
});
