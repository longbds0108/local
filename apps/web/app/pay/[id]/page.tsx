import { notFound } from "next/navigation";
import PaymentPreview from "@/components/PaymentPreview";
import { estimatePaymentFeeUsdc } from "@/lib/chain";
import { config } from "@/lib/env";
import { getItineraryView } from "@/lib/itinerary";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itinerary = await getItineraryView(id);
  if (!itinerary) notFound();

  const paidStops = itinerary.stops.filter((s) => Number(s.priceUsdc) > 0).length;
  const feeEstimate = config.paymentsConfigured && paidStops > 0 ? await estimatePaymentFeeUsdc(paidStops) : null;

  return (
    <PaymentPreview
      initial={itinerary}
      explorerUrl={config.explorerUrl ?? null}
      faucetUrl={config.faucetUrl ?? null}
      feeEstimate={feeEstimate}
      paymentsConfigured={config.paymentsConfigured}
    />
  );
}
