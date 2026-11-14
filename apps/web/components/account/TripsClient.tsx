"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CATEGORY_EMOJI, hhmm, usdc } from "@/lib/format";
import type { DashboardData, ItineraryView, StopView } from "@/lib/types";
import { paySplit } from "@/lib/pay-modes";
import { isExpiredDraft, useAccount, useDrafts } from "@/lib/use-account";
import { useI18n } from "../I18nProvider";
import { AccountPage, ConnectCard, DateBlock, ErrorNote, fill } from "./shared";

type Kind = "draft" | "active" | "past" | "expired";
type T = ReturnType<typeof useI18n>["t"];

export const tripHref = (id: string) => `/trips/${id}`;

export function stopState(s: StopView, t: T) {
  switch (s.status) {
    case "RELEASED":
      // Prepaid: released on arrival. Pay-at-venue: paid on arrival.
      return { icon: "✓", label: s.payMode === "VENUE" ? t.stopStatus.RELEASED : t.dashStopDone, cls: "bg-accent text-accent-ink" };
    case "REFUNDED":
      return { icon: "↩", label: t.dashStopRefunded, cls: "bg-surface-2 text-ink-2" };
    case "SKIPPED":
      return { icon: "–", label: t.stopSkipped, cls: "bg-surface-2 text-ink-2" };
    case "CHECKED_IN":
    case "REFUNDING":
      return { icon: "…", label: t.dashStopBusy, cls: "bg-warn-soft text-warn" };
    case "FREE":
      return s.payMode === "SELF"
        ? { icon: "·", label: t.stopPayYourself, cls: "bg-surface-2 text-ink-2" }
        : { icon: "·", label: t.stopStatus.FREE, cls: "bg-surface-2 text-ink-2" };
    default:
      return { icon: "", label: s.payMode === "VENUE" ? t.stopPayOnArrival : t.dashStopWaiting, cls: "border-2 border-accent" };
  }
}

function ctaLabel(it: ItineraryView, kind: Kind, t: T): string {
  if (kind === "draft") return paySplit(it.stops).prepay > 0 ? t.dashPay : t.startTrip;
  if (kind === "active") return it.stops.some((s) => s.payMode === "ESCROW" && s.status === "PENDING") ? t.dashOpenQr : t.dashOpenTrip;
  return kind === "expired" ? t.dashReplan : t.dashDetails;
}

function TripCard({ it, kind }: { it: ItineraryView; kind: Kind }) {
  const { t } = useI18n();
  const paidStops = it.stops.filter((s) => s.status !== "FREE");
  const done = paidStops.filter((s) => s.status === "RELEASED" || s.status === "REFUNDED" || s.status === "SKIPPED").length;
  const pill =
    kind === "draft"
      ? null
      : kind === "expired"
        ? { text: t.dashExpired, cls: "bg-surface-2 text-ink-2" }
        : { text: t.status[it.status] ?? it.status, cls: kind === "active" ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2" };
  const muted = kind === "past" || kind === "expired";

  // The whole card opens the trip; one page per trip, whatever its state.
  return (
    <Link
      href={tripHref(it.id)}
      className={`fx-lift block min-w-0 rounded-[20px] border bg-surface p-4 hover:border-accent/50 ${muted ? "border-line/60" : "border-line"}`}
    >
      <div className="flex items-start gap-3">
        <DateBlock iso={it.startAt} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 font-display text-base leading-snug font-bold text-white">{it.title}</h3>
            {pill && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${pill.cls}`}>{pill.text}</span>}
          </div>
          <p className="mt-0.5 text-xs text-ink-2">
            {hhmm(it.startAt)}–{hhmm(it.endAt)} · {it.partySize} {it.partySize === 1 ? t.person : t.people} · {it.stops.length} {t.dashStopsWord}
          </p>
        </div>
      </div>

      {!muted && (
        <ol className="mt-3 space-y-1.5 border-t border-line pt-3">
          {it.stops.map((s) => {
            const st = stopState(s, t);
            return (
              <li key={s.id} className="flex min-w-0 items-center gap-2.5 text-sm">
                <time className="w-10 shrink-0 text-xs text-ink-2 tabular-nums">{hhmm(s.arriveAt)}</time>
                {kind === "draft" ? (
                  <span className="w-5 shrink-0 text-center" aria-hidden>
                    {CATEGORY_EMOJI[s.category] ?? "📍"}
                  </span>
                ) : (
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black ${st.cls}`} aria-hidden>
                    {st.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[#d9e8e2]">{s.name}</span>
                <span className="shrink-0 text-[11px] text-ink-2">
                  {kind === "draft" ? (Number(s.priceUsdc) > 0 ? usdc(s.priceUsdc) : t.free) : st.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <b className="block text-lg leading-tight text-white">{usdc(it.totalUsdc)}</b>
          {(kind === "active" || kind === "past") && paidStops.length > 0 && (
            <span className="text-xs text-ink-2">{fill(t.dashProgress, { done, total: paidStops.length })}</span>
          )}
        </div>
        <span
          className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-bold ${
            muted ? "border border-line text-ink" : "bg-accent text-accent-ink"
          }`}
        >
          {ctaLabel(it, kind, t)} →
        </span>
      </div>
    </Link>
  );
}

function Group({ title, count, note, children }: { title: string; count: number; note?: string; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-2">
          {title}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold">{count}</span>
        </h2>
        {note && <p className="mt-0.5 text-xs text-ink-2/80">{note}</p>}
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-3">{children}</div>
    </section>
  );
}

type NextAction = { title: string; body: string; cta: string; href: string; external?: boolean };

function nextAction(data: DashboardData | null, drafts: ItineraryView[], t: T): NextAction {
  const now = Date.now() / 1000;
  let best: { it: ItineraryView; s: StopView } | null = null;
  for (const it of data?.active ?? []) {
    if ((it.deadline ?? Infinity) < now) continue;
    for (const s of it.stops) {
      if (s.status !== "PENDING") continue;
      if (!best || s.arriveAt < best.s.arriveAt) best = { it, s };
    }
  }
  if (best) {
    return {
      title: fill(t.dashNextCheckin, { place: best.s.name, time: hhmm(best.s.arriveAt) }),
      body: fill(t.dashNextCheckinBody, { trip: best.it.title }),
      cta: best.s.payMode === "VENUE" ? t.dashOpenTrip : t.dashOpenQr,
      href: tripHref(best.it.id),
    };
  }
  const draft = drafts[0];
  if (draft) {
    const prepay = paySplit(draft.stops).prepay;
    return prepay > 0
      ? { title: fill(t.dashNextPay, { trip: draft.title }), body: fill(t.dashNextPayBody, { total: usdc(prepay) }), cta: t.dashPay, href: tripHref(draft.id) }
      : { title: fill(t.dashNextStart, { trip: draft.title }), body: t.startNote, cta: t.startTrip, href: tripHref(draft.id) };
  }
  if (data && data.balanceUsdc !== null && Number(data.balanceUsdc) < 1) {
    return { title: t.dashNextTopUp, body: t.dashNextTopUpBody, cta: t.dashTopUp, href: data.faucetUrl ?? "https://faucet.circle.com", external: true };
  }
  return { title: t.dashNextPlan, body: t.dashNextPlanBody, cta: t.dashNextPlanCta, href: "/#ask" };
}

/** /trips — every trip in one list, plus the one thing to do next. */
export default function TripsClient() {
  const { t } = useI18n();
  const { session, checked, data, loading, error, connecting, connect, balance } = useAccount("/trips");
  const drafts = useDrafts();
  const liveDrafts = useMemo(() => (drafts ?? []).filter((d) => !isExpiredDraft(d)), [drafts]);
  const expiredDrafts = useMemo(() => (drafts ?? []).filter(isExpiredDraft), [drafts]);
  const upcoming = useMemo(() => [...(data?.active ?? [])].sort((a, b) => (a.startAt < b.startAt ? -1 : 1)), [data]);
  const pastCount = (data?.history.length ?? 0) + expiredDrafts.length;
  const tripCount = liveDrafts.length + upcoming.length + pastCount;
  // With a wallet: wait for its data. Without: drafts alone decide.
  const ready = drafts !== null && checked && (!session || !!data);
  const next = ready && (!session || data?.wallet) ? nextAction(session ? data : null, liveDrafts, t) : null;

  return (
    <AccountPage
      title={t.dashTitle}
      subtitle={t.tripsSubtitle}
      aside={
        session && (
          <Link
            href="/wallet"
            className="fx-lift flex min-h-11 shrink-0 flex-col items-end justify-center rounded-xl border border-line bg-surface px-3 py-1.5 text-right hover:border-accent/50"
          >
            <span className="text-[11px] text-ink-2">{t.dashBalance}</span>
            <b className="text-sm text-white">{balance !== null ? `${balance} USDC` : loading ? "…" : "—"}</b>
          </Link>
        )
      }
    >
      <ErrorNote text={error} />
      {session && data && !data.wallet && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{t.dashNoWallet}</p>}

      {next ? (
        <section className="fx-aurora fx-pan rounded-[24px] bg-gradient-to-br from-[#0f3a32] via-[#0b2a24] to-[#081d19] p-5 md:p-6">
          <div className="text-[11px] font-extrabold tracking-[2px] text-accent">{t.dashNext}</div>
          <h2 className="mt-2 font-display text-xl leading-snug font-extrabold text-white md:text-2xl">{next.title}</h2>
          <p className="mt-1.5 text-sm text-[#b8cdc6]">{next.body}</p>
          {next.external ? (
            <a href={next.href} target="_blank" rel="noreferrer" className="fx-shine mt-4 inline-flex min-h-12 items-center rounded-xl bg-accent px-5 text-base font-bold text-accent-ink">
              {next.cta} ↗
            </a>
          ) : (
            <Link href={next.href} className="fx-shine mt-4 inline-flex min-h-12 items-center rounded-xl bg-accent px-5 text-base font-bold text-accent-ink">
              {next.cta} →
            </Link>
          )}
        </section>
      ) : (
        !ready && <div className="fx-skeleton h-[168px] rounded-[24px] bg-surface" />
      )}

      {/* Planning needs no wallet; paying does. */}
      {checked && !session && <ConnectCard compact onConnect={() => void connect()} connecting={connecting} />}

      <div className="space-y-6">
        {ready && tripCount === 0 && <p className="rounded-[20px] border border-dashed border-[#2b4a43] p-5 text-sm text-ink-2">{t.dashNoTrips}</p>}
        {session && !data && loading && <div className="fx-skeleton h-40 rounded-[20px] bg-surface" />}
        <Group title={t.dashUnpaid} count={liveDrafts.length} note={t.draftsNote}>
          {liveDrafts.map((it) => <TripCard key={it.id} it={it} kind="draft" />)}
        </Group>
        <Group title={t.dashUpcoming} count={upcoming.length}>
          {upcoming.map((it) => <TripCard key={it.id} it={it} kind="active" />)}
        </Group>
        <Group title={t.dashPast} count={pastCount}>
          {data?.history.map((it) => <TripCard key={it.id} it={it} kind="past" />)}
          {expiredDrafts.map((it) => <TripCard key={it.id} it={it} kind="expired" />)}
        </Group>
        <Link
          href="/#ask"
          className="fx-lift flex min-h-12 items-center justify-center gap-2 rounded-[20px] border border-dashed border-[#2b4a43] text-sm font-bold text-accent hover:border-accent/60 hover:bg-white/[0.03]"
        >
          ✦ {t.dashNewTrip}
        </Link>
      </div>
    </AccountPage>
  );
}
