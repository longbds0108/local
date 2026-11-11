// Types shared by server and client (no server-only imports here).

// CHECKED_IN / REFUNDING are short-lived locks while the on-chain tx is in flight.
export type StopStatus = "FREE" | "PENDING" | "CHECKED_IN" | "REFUNDING" | "RELEASED" | "REFUNDED";
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
  status: StopStatus;
  onchainIndex: number | null;
  releaseTx: string | null;
  refundTx: string | null;
  merchant: { id: string; name: string; walletAddress: string } | null;
};

export type ItineraryView = {
  id: string;
  title: string;
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
  type: "deposit" | "release" | "refund";
  itineraryId: string;
  title: string;
  merchant?: string | null;
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
