import { NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { findDepositTx, readEscrowItinerary } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { getItineraryView, getItineraryWithStops } from "@/lib/itinerary";
import { toBaseUnits } from "@/lib/pricing";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ itineraryId: z.string().min(1).max(64) });

/**
 * Called by the client after the deposit challenge completes. Trust comes from the
 * chain, not the client: we read the escrow and only mark PAID if the on-chain
 * deposit matches the itinerary's merchants and amounts.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`confirm:${clientIp(req)}`, 60, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { itineraryId } = await parseJson(req, Body);
  const it = await getItineraryWithStops(itineraryId);
  if (!it) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  if (it.status !== "DRAFT") return NextResponse.json({ paid: true, itinerary: await getItineraryView(itineraryId) });
  if (!it.onchainId) return NextResponse.json({ paid: false });

  const onchain = await readEscrowItinerary(it.onchainId as Hex);
  if (/^0x0{40}$/i.test(onchain.payer)) return NextResponse.json({ paid: false });

  const paidStops = it.stops.filter((s) => s.onchainIndex !== null).sort((a, b) => a.onchainIndex! - b.onchainIndex!);
  const matches =
    onchain.stops.length === paidStops.length &&
    paidStops.every((s, i) => {
      const o = onchain.stops[i];
      return (
        s.merchant !== null &&
        getAddress(o.merchant) === getAddress(s.merchant.walletAddress) &&
        o.amount === toBaseUnits(s.priceUsdc.toString())
      );
    });
  if (!matches) {
    throw new ApiError(409, "CONFLICT", "On-chain deposit does not match this itinerary (it was edited after payment started)");
  }

  const txHash = await findDepositTx(it.onchainId as Hex);
  const payer = getAddress(onchain.payer);
  const user = await prisma.user.findFirst({ where: { walletAddress: payer } });
  await prisma.itinerary.update({
    where: { id: itineraryId },
    data: {
      status: "PAID",
      depositTxHash: txHash,
      payerAddress: payer,
      deadline: Number(onchain.deadline),
      userId: user?.id ?? undefined,
    },
  });
  return NextResponse.json({ paid: true, itinerary: await getItineraryView(itineraryId) });
});
