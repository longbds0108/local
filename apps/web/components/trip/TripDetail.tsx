"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CircleClientError,
  connectWallet,
  ensureWallet,
  getOrRefreshSession,
  getSession,
  logout,
  SESSION_EVENT,
} from "@/lib/circle-client";
import { errorText } from "@/lib/error-text";
import { CATEGORY_EMOJI, hhmm, tripDay, usdc } from "@/lib/format";
import { forViewer, isOrganizer, myShare } from "@/lib/group-view";
import { payModeLabel } from "@/lib/stop-info";
import { paySplit } from "@/lib/pay-modes";
import { isExpiredDraft } from "@/lib/use-account";
import type { ItineraryView } from "@/lib/types";
import { BackLink, DateBlock } from "../account/shared";
import { useI18n } from "../I18nProvider";
import GroupPanel from "./GroupPanel";
import { PriceLabel } from "../ItineraryCard";
import PaymentPanel from "./PaymentPanel";
import VoucherPanel from "./VoucherPanel";
import { stopNote, tripTitle } from "@/lib/trip-i18n";

type Props = {
  initial: ItineraryView;
  explorerUrl: string | null;
  faucetUrl: string | null;
  feeEstimate: string | null;
  paymentsConfigured: boolean;
  walletPaymentsConfigured: boolean;
};

/** Plan → Pay → Go & scan → Done. Index of the step the trip is on. */
function currentStep(it: ItineraryView): number {
  if (it.status === "DRAFT") return 1;
  if (it.status === "PAID") return 2;
  return 4; // finished: every step done
}

function Stepper({ step, prepay }: { step: number; prepay: boolean }) {
  const { t, locale } = useI18n();
  // Trips with nothing to prepay are started, not paid.
  const labels = [t.stepPlan, prepay ? t.stepPay : t.stepStart, t.stepGo, t.stepDone];
  return (
    <ol className="grid grid-cols-4" aria-label={t.tripProgress}>
      {labels.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="relative flex flex-col items-center gap-1.5 text-center" aria-current={current ? "step" : undefined}>
            {i > 0 && (
              <span className={`absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2 ${done || current ? "bg-accent" : "bg-line"}`} aria-hidden />
            )}
            <span
              className={`relative z-[1] grid h-7 w-7 place-items-center rounded-full text-xs font-black ${
                done ? "bg-accent text-accent-ink" : current ? "border-2 border-accent bg-bg text-accent" : "border-2 border-line bg-bg text-ink-2"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`text-[11px] leading-tight font-semibold ${current ? "text-accent" : done ? "text-[#c5d8d1]" : "text-ink-2"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A group trip seen by someone who hasn't paid a share: the plan, with each person's part. */
function GroupStops({ it }: { it: ItineraryView }) {
  const { t, locale } = useI18n();
  return (
    <section className="rounded-[20px] border border-line bg-surface p-4">
      <h2 className="text-sm font-bold text-ink-2">{t.tripStops}</h2>
      <ul className="mt-1 divide-y divide-line">
        {it.stops.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">
                {i + 1}. {CATEGORY_EMOJI[s.category] ?? "📍"} {s.name}
              </div>
              <div className="text-xs text-ink-2">
                {hhmm(s.arriveAt)} · {s.durationMin} {t.minutes}
                {payModeLabel(t, s) && <span className="font-semibold text-accent"> · {payModeLabel(t, s)}</span>}
              </div>
            </div>
            {s.payMode === "ESCROW" ? (
              <span className="shrink-0 text-sm font-semibold text-white tabular-nums">
                {usdc((Number(s.priceUsdc) / it.partySize).toFixed(2))}
                <span className="text-xs font-normal text-ink-2">{t.perPerson}</span>
              </span>
            ) : (
              <PriceLabel stop={s} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** /trips/[id] — one page per trip; what it shows follows the trip's state. */
export default function TripDetail({ initial, explorerUrl, faucetUrl, feeEstimate, paymentsConfigured, walletPaymentsConfigured }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [it, setIt] = useState(initial);
  // A server refresh (after paying or starting) brings the trip's new state.
  useEffect(() => setIt(initial), [initial]);
  const onPaid = useCallback(() => router.refresh(), [router]);
  const [shared, setShared] = useState(false);
  const share = async () => {
    const url = window.location.href.split("?")[0];
    try {
      if (navigator.share) return await navigator.share({ title: tripTitle(it, locale), url });
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* user dismissed the share sheet */
    }
  };

  // Who is looking: on a group trip each member sees their own share.
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setViewer(getSession()?.walletAddress ?? null);
    read();
    void getOrRefreshSession()
      .then((s) => setViewer(s?.walletAddress ?? null))
      .catch(() => {});
    window.addEventListener(SESSION_EVENT, read);
    return () => window.removeEventListener(SESSION_EVENT, read);
  }, []);

  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const enableGroup = async () => {
    setGroupError(null);
    setGroupBusy(t.groupEnabling);
    try {
      let s = await getOrRefreshSession().catch(() => null);
      if (!s) s = await connectWallet(`/trips/${it.id}`);
      if (!s) return setGroupBusy(null);
      if (!s.walletAddress) s = await ensureWallet(s);
      setViewer(s.walletAddress ?? null);
      const res = await fetch("/api/group/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: s.userToken, itineraryId: it.id, enabled: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = (j as { error?: { code?: string; message?: string } }).error;
        if (e?.code === "UNAUTHORIZED") logout();
        setGroupError(errorText(t, e?.code, e?.message));
      } else setIt((j as { itinerary: ItineraryView }).itinerary);
    } catch (err) {
      setGroupError(errorText(t, err instanceof CircleClientError ? err.code : "NETWORK", (err as Error).message));
    } finally {
      setGroupBusy(null);
    }
  };
  const onGroupChange = useCallback(
    (next: ItineraryView) => {
      setIt(next);
      router.refresh();
    },
    [router],
  );

  const hasPrepay = paySplit(it.stops).prepay > 0;
  const step = currentStep(it);
  const expired = it.status === "DRAFT" && isExpiredDraft(it);
  const pill = expired
    ? { text: t.dashExpired, cls: "bg-surface-2 text-ink-2" }
    : it.status === "DRAFT"
      ? null
      : { text: t.status[it.status] ?? it.status, cls: it.status === "PAID" ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2" };

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-[18px] pt-4 pb-10">
      <div className="flex items-center justify-between gap-3">
        <BackLink href="/trips" label={t.dashTitle} />
        <button
          type="button"
          onClick={() => void share()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-accent/50"
        >
          ⤴ {shared ? t.linkCopied : t.share}
        </button>
      </div>

      <header className="flex items-start gap-3">
        <DateBlock iso={it.startAt} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[22px] leading-snug font-extrabold text-white">{tripTitle(it, locale)}</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {tripDay(it.startAt, t.dayTomorrow) && `${tripDay(it.startAt, t.dayTomorrow)} · `}{hhmm(it.startAt)}–{hhmm(it.endAt)} · {it.partySize} {it.partySize === 1 ? t.person : t.people} · {usdc(it.totalUsdc)}
          </p>
          {pill && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pill.cls}`}>{pill.text}</span>
            </div>
          )}
        </div>
      </header>

      {!expired && <Stepper step={step} prepay={paySplit(it.stops).prepay > 0} />}

      {it.group && !expired && (
        <GroupPanel it={it} viewer={viewer} onChange={onGroupChange} paymentsConfigured={hasPrepay ? paymentsConfigured : walletPaymentsConfigured} />
      )}
      {groupError && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {groupError}
        </p>
      )}

      {it.status === "DRAFT" ? (
        <PaymentPanel
          key={it.group ? "group" : "solo"}
          initial={it}
          faucetUrl={faucetUrl}
          feeEstimate={feeEstimate}
          paymentsConfigured={paymentsConfigured}
          walletPaymentsConfigured={walletPaymentsConfigured}
          onPaid={onPaid}
          // Group trip: prepaid shares are paid in the group panel; a trip paid only at venues is started by its organizer.
          hidePay={!!it.group && (hasPrepay || !isOrganizer(it, viewer))}
          onEnableGroup={it.group || !(hasPrepay ? paymentsConfigured : walletPaymentsConfigured) ? undefined : () => void enableGroup()}
          groupBusy={groupBusy}
        />
      ) : it.group && !(myShare(it, viewer) && myShare(it, viewer)!.status !== "PENDING") ? (
        <GroupStops it={it} />
      ) : (
        <VoucherPanel it={forViewer(it, viewer)} onChange={setIt} explorerUrl={explorerUrl} />
      )}
    </div>
  );
}
