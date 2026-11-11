// How a trip's money splits by when it is paid. Shared by server and client.
import type { PayMode } from "./types";

type StopLike = { payMode: PayMode | string; priceUsdc: string | number | { toString(): string } };

export type PaySplit = {
  /** Paid now, into the escrow (venues that take bookings). */
  prepay: number;
  /** Paid in the app at the venue (scan its QR). */
  atVenue: number;
  /** Not a partner venue: an estimate the traveller pays by themselves. */
  self: number;
  prepayStops: number;
  atVenueStops: number;
};

export function paySplit(stops: StopLike[]): PaySplit {
  const out: PaySplit = { prepay: 0, atVenue: 0, self: 0, prepayStops: 0, atVenueStops: 0 };
  for (const s of stops) {
    const price = Number(s.priceUsdc.toString());
    if (!(price > 0)) continue;
    if (s.payMode === "ESCROW") {
      out.prepay += price;
      out.prepayStops += 1;
    } else if (s.payMode === "VENUE") {
      out.atVenue += price;
      out.atVenueStops += 1;
    } else if (s.payMode === "SELF") out.self += price;
  }
  return out;
}

/** Stops that need something done in the app while travelling. */
export const inAppMode = (m: string) => m === "ESCROW" || m === "VENUE";
