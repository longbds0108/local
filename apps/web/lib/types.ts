// Types shared by server and client (no server-only imports here).

// CHECKED_IN / REFUNDING are short-lived locks while the on-chain tx is in flight.
// SKIPPED: a pay-at-venue stop the traveller never paid (no money was held for it).
export type StopStatus = "FREE" | "PENDING" | "CHECKED_IN" | "REFUNDING" | "RELEASED" | "REFUNDED" | "SKIPPED";
/**
 * ESCROW: prepaid now, released to the venue with the check-in code.
 * VENUE:  paid straight to the venue's wallet on arrival (scan its QR).
 * SELF:   the venue isn't a partner — an estimate; the traveller pays it themselves.
 * NONE:   free.
 */
export type PayMode = "ESCROW" | "VENUE" | "SELF" | "NONE";
export type ItineraryStatus = "DRAFT" | "PAID" | "COMPLETED" | "REFUNDED" | "PARTIAL";

export type StopView = {
  id: string;
  order: number;
  osmId: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  arriveAt: string;
  durationMin: number;
  travelMin: number;
  priceUsdc: string;
  priceSource: "seed" | "estimate";
  note: string | null;
  /** The same note in each UI language (AI-written; null on older trips). */
  noteVi: string | null;
  noteEn: string | null;
  status: StopStatus;
  payMode: PayMode;
  /** VENUE stops: the amount actually paid at the venue. */
  paidUsdc: string | null;
  /** VENUE stops: a payment was started (look for it on-chain before paying again). */
  payStarted: boolean;
  onchainIndex: number | null;
  releaseTx: string | null;
  refundTx: string | null;
  merchant: { id: string; name: string; walletAddress: string } | null;
};

export type ItineraryView = {
  id: string;
  title: string;
  /** The same title in each UI language (AI-written; null on older trips). */
  titleVi: string | null;
  titleEn: string | null;
  startAt: string;
  endAt: string;
  partySize: number;
  totalUsdc: string;
  status: ItineraryStatus;
  depositTxHash: string | null;
  onchainId: string | null;
  deadline: number | null;
  payerAddress: string | null;
  profile: string;
  geometry: { type: "LineString"; coordinates: [number, number][] } | null;
  stops: StopView[];
  /** Group trip: each member prepays their own share. Null for a one-payer trip. */
  group: GroupView | null;
};

export type GroupShareStatus = "JOINED" | "PENDING" | "PAID" | "DONE" | "REFUNDED" | "PARTIAL";
export type GroupShareView = {
  id: string;
  payerAddress: string;
  people: number;
  status: GroupShareStatus;
  paidAt: string | null;
  depositTx: string | null;
  stops: { stopId: string; amountUsdc: string; status: string; releaseTx: string | null; refundTx: string | null }[];
};
/** A bill split at a venue: each member pays their part straight to the venue. */
export type VenueBillView = {
  stopId: string;
  totalUsdc: string;
  createdBy: string;
  parts: { payerAddress: string; amountUsdc: string; status: "PENDING" | "PAID"; txHash: string | null; started: boolean }[];
};
export type GroupView = {
  organizerAddress: string | null;
  /** Bills split at venues, one per pay-at-venue stop. */
  bills: VenueBillView[];
  /** One person's part of the prepaid stops, in USDC. */
  perPersonUsdc: string;
  /** Seats covered by members (paid shares, or joined on a trip paid only at venues). */
  paidPeople: number;
  shares: GroupShareView[];
};

export type MapPlace = {
  osmId: string;
  name: string;
  nameEn?: string;
  lat: number;
  lon: number;
  category: string;
  openingHours?: string;
  priceUsdc: number;
  priceSource: "seed" | "estimate";
  merchantId?: string;
  distanceM: number;
  source: "seed" | "osm";
  /** true/false from opening_hours at request time; null = unknown. */
  openNow?: boolean | null;
};

/** Server-sent events from /api/chat. */
export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "done" | "error"; summary?: string }
  | { type: "places"; places: MapPlace[] }
  | { type: "itinerary"; itinerary: ItineraryView }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

export type DashboardActivity = {
  type: "deposit" | "release" | "venue" | "refund";
  itineraryId: string;
  title: string;
  /** Deposit rows: the trip title in each UI language. */
  titleVi?: string | null;
  titleEn?: string | null;
  merchant?: string | null;
  merchantId?: string | null;
  amountUsdc: string;
  txHash: string | null;
  at: string;
};

export type DashboardData = {
  wallet: { id: string; address: string } | null;
  balanceUsdc: string | null;
  explorerUrl: string | null;
  faucetUrl: string | null;
  stats: { escrowedUsdc: string; releasedUsdc: string; refundedUsdc: string; trips: number; activeVouchers: number };
  drafts: ItineraryView[];
  active: ItineraryView[];
  history: ItineraryView[];
  activity: DashboardActivity[];
};

/** A dashboard with no wallet yet: every list empty, every total zero. */
export function emptyDashboard(explorerUrl: string | null = null, faucetUrl: string | null = null): DashboardData {
  return {
    wallet: null,
    balanceUsdc: null,
    explorerUrl,
    faucetUrl,
    stats: { escrowedUsdc: "0", releasedUsdc: "0", refundedUsdc: "0", trips: 0, activeVouchers: 0 },
    drafts: [],
    active: [],
    history: [],
    activity: [],
  };
}

/** Fill anything a response left out, so pages never read a field of undefined. */
export function normalizeDashboard(raw: Partial<DashboardData>): DashboardData {
  const base = emptyDashboard(raw.explorerUrl ?? null, raw.faucetUrl ?? null);
  return { ...base, ...raw, stats: { ...base.stats, ...(raw.stats ?? {}) } } as DashboardData;
}
