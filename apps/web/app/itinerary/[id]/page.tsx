import { redirect } from "next/navigation";

/** Old link: QR codes now live on the trip page. */
export default async function ItineraryRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/trips/${encodeURIComponent(id)}`);
}
