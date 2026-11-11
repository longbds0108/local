import { notFound } from "next/navigation";
import TripDetail from "@/components/trip/TripDetail";
import { estimatePaymentFeeUsdc } from "@/lib/chain";
import { config } from "@/lib/env";
import { getItineraryWithStops, toView } from "@/lib/itinerary";
import { qrPayload } from "@/lib/qr";

export const dynamic = "force-dynamic";

/** One page per trip: pay while it's a draft, then its QR codes, then its result. */
export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const it = await getItineraryWithStops(id);
  if (!it) notFound();
  const view = toView(it);

  // QR payloads are signed server-side; secrets never leave the server.
  // MVP: anyone with this (unguessable) link can see the codes.
  const vouchers: Record<string, string> = {};
  if (it.status !== "DRAFT") {
    for (const s of it.stops) if (s.status === "PENDING") vouchers[s.id] = qrPayload(s.id, s.qrSecret);
  }

  const paidStops = view.stops.filter((s) => Number(s.priceUsdc) > 0).length;
  const feeEstimate =
    it.status === "DRAFT" && config.paymentsConfigured && paidStops > 0 ? await estimatePaymentFeeUsdc(paidStops).catch(() => null) : null;

  return (
    <TripDetail
      initial={view}
      vouchers={vouchers}
      explorerUrl={config.explorerUrl ?? null}
      faucetUrl={config.faucetUrl ?? null}
      feeEstimate={feeEstimate}
      paymentsConfigured={config.paymentsConfigured}
    />
  );
}
