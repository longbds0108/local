import { notFound } from "next/navigation";
import { after } from "next/server";
import TripDetail from "@/components/trip/TripDetail";
import { estimatePaymentFeeUsdc } from "@/lib/chain";
import { config } from "@/lib/env";
import { getItineraryWithStops, toView } from "@/lib/itinerary";
import { isOverdue, sweepItinerary } from "@/lib/refunds";

export const dynamic = "force-dynamic";

/** One page per trip: pay while it's a draft, then its QR codes, then its result. */
export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const it = await getItineraryWithStops(id);
  if (!it) notFound();
  const view = toView(it);
  // after(): runs once the page is sent, and the platform keeps the function alive for it.
  if (isOverdue(view)) after(() => sweepItinerary(view.id));

  // Check-in QR codes are built in the traveller's browser from codes only it
  // holds, so this link can be shared without exposing them.
  const paidStops = view.stops.filter((s) => s.payMode === "ESCROW" && Number(s.priceUsdc) > 0).length;
  const feeEstimate =
    it.status === "DRAFT" && config.paymentsConfigured && paidStops > 0 ? await estimatePaymentFeeUsdc(paidStops).catch(() => null) : null;

  return (
    <TripDetail
      initial={view}
      explorerUrl={config.explorerUrl ?? null}
      faucetUrl={config.faucetUrl ?? null}
      feeEstimate={feeEstimate}
      paymentsConfigured={config.paymentsConfigured}
      walletPaymentsConfigured={config.walletPaymentsConfigured}
    />
  );
}
