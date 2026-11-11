import type { Dict } from "./i18n";
import type { StopView } from "./types";

/** What the traveller's money buys at this stop (seeded venues say exactly; others are an estimate). */
export function stopOffer(t: Dict, s: StopView): string | null {
  if (!(Number(s.priceUsdc) > 0)) return null;
  const id = s.merchant?.id;
  return (id && t.offer[id]) || (s.priceSource === "estimate" ? t.offer.estimate : t.offer.default);
}

/** Directions in Google Maps (opens the app on phones). */
export function directionsUrl(s: { lat: number; lon: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
}
