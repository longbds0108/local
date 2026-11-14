// What a group trip looks like to the person viewing it: each prepaid stop shows
// that member's own part (their amount, their status); the trip's QR and refund
// actions then work on their part only. Someone who hasn't paid a share sees the
// plan without in-app payments.
import type { ItineraryView, StopStatus } from "./types";

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function myShare(it: ItineraryView, viewer: string | null) {
  return it.group?.shares.find((s) => same(s.payerAddress, viewer)) ?? null;
}

export function isOrganizer(it: ItineraryView, viewer: string | null) {
  return same(it.group?.organizerAddress, viewer);
}

export function forViewer(it: ItineraryView, viewer: string | null): ItineraryView {
  if (!it.group) return it;
  const share = myShare(it, viewer);
  const paidShare = share && share.status !== "PENDING" ? share : null;
  // At-venue bills: the organizer or any member who paid a share can pay them.
  const canPayVenue = same(it.payerAddress, viewer) || isOrganizer(it, viewer) || !!paidShare;
  return {
    ...it,
    stops: it.stops.map((s) => {
      if (s.payMode === "ESCROW") {
        const part = paidShare?.stops.find((p) => p.stopId === s.id);
        if (!part) return { ...s, payMode: "NONE", status: "FREE", priceUsdc: "0" };
        return { ...s, priceUsdc: part.amountUsdc, status: part.status as StopStatus, releaseTx: part.releaseTx, refundTx: part.refundTx };
      }
      if (s.payMode === "VENUE" && !canPayVenue) return { ...s, payMode: "NONE", status: "FREE", priceUsdc: "0" };
      return s;
    }),
  };
}
