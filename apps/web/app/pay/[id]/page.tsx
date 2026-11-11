import { redirect } from "next/navigation";

/** Old link: payment now lives on the trip page. */
export default async function PayRedirect({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ autopay?: string }> }) {
  const { id } = await params;
  const { autopay } = await searchParams;
  redirect(`/trips/${encodeURIComponent(id)}${autopay === "1" ? "?autopay=1" : ""}`);
}
