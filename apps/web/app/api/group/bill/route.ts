import { NextResponse } from "next/server";
import { getAddress, isAddress, parseUnits } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { groupMembers } from "@/lib/group";
import { getItineraryView } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Usdc = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/);
const Body = z.object({
  userToken: z.string().min(10).max(4000),
  stopId: z.string().min(1).max(64),
  /** The venue whose QR was scanned; must be this stop's venue. */
  merchantId: z.string().min(1).max(64),
  totalUsdc: Usdc,
  /** Who pays what. Every payer must be a member; the parts must add up to the total. */
  parts: z
    .array(z.object({ payerAddress: z.string().refine((a) => isAddress(a), "invalid address"), amountUsdc: Usdc }))
    .min(1)
    .max(20),
});

/**
 * At a venue on a group trip, a member enters the bill and how it's split. Each member
 * then pays their own part straight to the venue's wallet (/api/group/bill/pay). A bill
 * can be redone until someone has started paying it.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`group-bill:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const body = await parseJson(req, Body);

  const stop = await prisma.stop.findUnique({ where: { id: body.stopId }, include: { itinerary: true, bill: { include: { parts: true } } } });
  if (!stop || stop.payMode !== "VENUE" || !stop.itinerary.groupMode) throw new ApiError(404, "NOT_FOUND", "Stop not found");
  if (stop.merchantId !== body.merchantId) throw new ApiError(403, "FORBIDDEN", "This QR code belongs to another partner");
  if (stop.itinerary.status !== "PAID") throw new ApiError(409, "CONFLICT", "Start the trip first");
  if (stop.status !== "PENDING") throw new ApiError(409, "CONFLICT", `Already paid (${stop.status})`);
  if (stop.bill?.parts.some((p) => p.status === "PAID" || p.fromBlock !== null)) {
    throw new ApiError(409, "CONFLICT", "Someone has already started paying this bill");
  }

  const wallet = await getArcWallet(body.userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Create your wallet first");
  const me = getAddress(wallet.address);
  const members = new Set((await groupMembers(stop.itineraryId)).map((m) => getAddress(m.payerAddress)));
  if (!members.has(me)) throw new ApiError(403, "FORBIDDEN", "Join the group first");

  const parts = body.parts.map((p) => ({ payerAddress: getAddress(p.payerAddress), amountUsdc: p.amountUsdc }));
  if (new Set(parts.map((p) => p.payerAddress)).size !== parts.length) throw new ApiError(400, "BAD_REQUEST", "Invalid request");
  if (parts.some((p) => !members.has(p.payerAddress))) throw new ApiError(400, "BAD_REQUEST", "Everyone on the bill must be in the group");
  if (parts.some((p) => parseUnits(p.amountUsdc, 6) <= 0n)) throw new ApiError(400, "BAD_REQUEST", "Enter an amount");
  const sum = parts.reduce((s, p) => s + parseUnits(p.amountUsdc, 6), 0n);
  if (sum !== parseUnits(body.totalUsdc, 6)) throw new ApiError(400, "BAD_REQUEST", "The parts don't add up to the bill");

  await prisma.$transaction(async (tx) => {
    await tx.venueBill.deleteMany({ where: { stopId: stop.id } });
    await tx.venueBill.create({
      data: { stopId: stop.id, totalUsdc: body.totalUsdc, createdBy: me, parts: { create: parts.map((p) => ({ ...p, status: "PENDING" })) } },
    });
  });
  return NextResponse.json({ itinerary: await getItineraryView(stop.itineraryId) });
});
