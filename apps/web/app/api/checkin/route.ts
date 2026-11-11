import { NextResponse } from "next/server";
import { keccak256, type Hex } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { relayRelease } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { recomputeItineraryStatus } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  stopId: z.string().min(1).max(64),
  /** The stop's check-in code from the traveller's QR (32 bytes, hex). */
  code: z.string().regex(/^(0x)?[0-9a-f]{64}$/i),
  merchantId: z.string().min(1).max(64),
});

/**
 * A venue scanned a traveller's QR. The QR carries the stop's check-in code; we
 * check it against the stored hash (to fail fast), then relay release(id, index,
 * code). The contract verifies the code itself and can only pay the merchant
 * fixed at deposit — the operator key just pays gas.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`checkin:${clientIp(req)}`, 30, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { stopId, code: rawCode, merchantId } = await parseJson(req, Body);
  const code = (rawCode.startsWith("0x") ? rawCode : `0x${rawCode}`).toLowerCase() as Hex;

  const stop = await prisma.stop.findUnique({ where: { id: stopId }, include: { itinerary: true, merchant: true } });
  // Same response for unknown stop and bad signature: don't leak which stop ids exist.
  if (!stop || !stop.codeHash || keccak256(code).toLowerCase() !== stop.codeHash.toLowerCase()) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid voucher");
  }
  if (stop.merchantId !== merchantId) {
    throw new ApiError(403, "FORBIDDEN", "This QR code belongs to another partner");
  }
  if (stop.itinerary.status !== "PAID") throw new ApiError(409, "CONFLICT", `Itinerary is not in PAID state (${stop.itinerary.status})`);
  if (stop.status !== "PENDING") throw new ApiError(409, "CONFLICT", `Voucher already used (${stop.status})`);
  const deadline = stop.itinerary.deadline;
  if (!deadline || Date.now() / 1000 >= deadline) throw new ApiError(410, "EXPIRED", "Voucher expired");
  if (stop.onchainIndex === null || !stop.itinerary.onchainId) throw new ApiError(409, "CONFLICT", "Stop is not escrowed on-chain");

  // Lock the stop so two scans can't release twice (the contract also prevents it).
  const locked = await prisma.stop.updateMany({
    where: { id: stop.id, status: "PENDING" },
    data: { status: "CHECKED_IN", checkedInAt: new Date() },
  });
  if (locked.count !== 1) throw new ApiError(409, "CONFLICT", "Voucher is being processed");

  let txHash: Hex;
  try {
    txHash = await relayRelease(stop.itinerary.onchainId as Hex, stop.onchainIndex, code);
  } catch (err) {
    await prisma.stop.update({ where: { id: stop.id }, data: { status: "PENDING", checkedInAt: null } });
    console.error("[checkin] release failed", err);
    throw new ApiError(502, "CHAIN_ERROR", `On-chain release failed: ${(err as Error).message.split("\n")[0]}`);
  }

  await prisma.stop.update({ where: { id: stop.id }, data: { status: "RELEASED", releaseTx: txHash } });
  await recomputeItineraryStatus(stop.itineraryId);

  return NextResponse.json({
    ok: true,
    stop: { id: stop.id, name: stop.name, amountUsdc: stop.priceUsdc.toString() },
    merchant: stop.merchant ? { id: stop.merchant.id, name: stop.merchant.name, walletAddress: stop.merchant.walletAddress } : null,
    txHash,
    explorerTxUrl: config.explorerUrl ? `${config.explorerUrl}/tx/${txHash}` : null,
  });
});
