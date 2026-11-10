import { notFound } from "next/navigation";
import ItineraryDetail from "@/components/ItineraryDetail";
import { config } from "@/lib/env";
import { getItineraryWithStops, toView } from "@/lib/itinerary";
import { qrPayload } from "@/lib/qr";

export const dynamic = "force-dynamic";

export default async function ItineraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const it = await getItineraryWithStops(id);
  if (!it) notFound();

  // Voucher QR payloads are signed server-side; secrets never leave the server.
  // MVP: anyone with this (unguessable) link can see the vouchers.
  const vouchers: Record<string, string> = {};
  if (it.status !== "DRAFT") {
    for (const s of it.stops) if (s.status === "PENDING") vouchers[s.id] = qrPayload(s.id, s.qrSecret);
  }

  return <ItineraryDetail initial={toView(it)} vouchers={vouchers} explorerUrl={config.explorerUrl ?? null} />;
}
