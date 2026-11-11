"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleClientError,
  circleConfigured,
  connectWallet,
  getOrRefreshSession,
  getSession,
  logout,
  SESSION_EVENT,
  type CircleSession,
} from "@/lib/circle-client";
import { CATEGORY_EMOJI, hhmm, shortAddr, usdc } from "@/lib/format";
import type { DashboardActivity, DashboardData, ItineraryView, StopView } from "@/lib/types";
import { useI18n } from "./I18nProvider";

const DRAFT_KEY = "hedgora.chat.itinerary";
const TZ = "Asia/Ho_Chi_Minh";
type Tab = "trips" | "wallet";
type Kind = "draft" | "active" | "past";

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);

function DateBlock({ iso }: { iso: string }) {
  const { locale } = useI18n();
  const d = new Date(iso);
  const loc = locale === "vi" ? "vi-VN" : "en-GB";
  const wd = new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: "short" }).format(d);
  const dm = new Intl.DateTimeFormat(loc, { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d).replace(/[-.]/g, "/");
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-surface-2 text-center leading-tight">
      <div>
        <div className="text-[11px] font-bold text-ink-2 uppercase">{wd}</div>
        <div className="font-display text-sm font-extrabold text-white">{dm}</div>
      </div>
    </div>
  );
}

function stopState(s: StopView, t: ReturnType<typeof useI18n>["t"]) {
  switch (s.status) {
    case "RELEASED":
      return { icon: "✓", label: t.dashStopDone, cls: "bg-accent text-accent-ink" };
    case "REFUNDED":
      return { icon: "↩", label: t.dashStopRefunded, cls: "bg-surface-2 text-ink-2" };
    case "CHECKED_IN":
    case "REFUNDING":
      return { icon: "…", label: t.dashStopBusy, cls: "bg-warn-soft text-warn" };
    case "FREE":
      return { icon: "·", label: t.stopStatus.FREE, cls: "bg-surface-2 text-ink-2" };
    default:
      return { icon: "", label: t.dashStopWaiting, cls: "border-2 border-accent" };
  }
}

function TripCard({ it, kind }: { it: ItineraryView; kind: Kind }) {
  const { t } = useI18n();
  const paidStops = it.stops.filter((s) => s.status !== "FREE");
  const done = paidStops.filter((s) => s.status === "RELEASED" || s.status === "REFUNDED").length;
  const href = kind === "draft" ? `/pay/${it.id}` : `/itinerary/${it.id}`;
  const pill =
    kind === "draft"
      ? { text: t.dashUnpaid, cls: "bg-warn-soft text-warn" }
      : { text: t.status[it.status] ?? it.status, cls: kind === "active" ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2" };

  return (
    <article className={`min-w-0 rounded-[20px] border bg-surface p-4 ${kind === "past" ? "border-line/60" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <DateBlock iso={it.startAt} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 font-display text-base leading-snug font-bold text-white">{it.title}</h3>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${pill.cls}`}>{pill.text}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-2">
            {hhmm(it.startAt)}–{hhmm(it.endAt)} · {it.partySize} {t.people} · {it.stops.length} {t.dashStopsWord}
          </p>
        </div>
      </div>

      {kind !== "past" && (
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
          {kind !== "draft" && paidStops.length > 0 && (
            <span className="text-xs text-ink-2">{fill(t.dashProgress, { done, total: paidStops.length })}</span>
          )}
        </div>
        <Link
          href={href}
          className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-bold ${
            kind === "past" ? "border border-line text-ink" : "bg-accent text-accent-ink"
          }`}
        >
          {kind === "draft" ? t.dashPay : kind === "active" ? t.dashOpenQr : t.dashDetails} →
        </Link>
      </div>
    </article>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold text-ink-2">
        {title}
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold">{count}</span>
      </h2>
      <div className="grid grid-cols-1 gap-3">{children}</div>
    </section>
  );
}

function ActivityRow({ a, explorerUrl }: { a: DashboardActivity; explorerUrl: string | null }) {
  const { t, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(a.at));
  const meta = {
    deposit: { icon: "↑", title: fill(t.dashTxPay, { trip: a.title }), note: t.dashTxPayNote, amount: `−${usdc(a.amountUsdc)}`, amountCls: "text-white", iconCls: "bg-surface-2 text-ink" },
    release: { icon: "✓", title: fill(t.dashTxRelease, { merchant: a.merchant ?? a.title }), note: t.dashTxReleaseNote, amount: usdc(a.amountUsdc), amountCls: "text-ink-2", iconCls: "bg-accent-soft text-accent" },
    refund: { icon: "↩", title: fill(t.dashTxRefund, { place: a.title }), note: t.dashTxRefundNote, amount: `+${usdc(a.amountUsdc)}`, amountCls: "text-accent", iconCls: "bg-accent-soft text-accent" },
  }[a.type];
  const inner = (
    <>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-bold ${meta.iconCls}`} aria-hidden>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{meta.title}</div>
        <div className="truncate text-xs text-ink-2">
          {when} · {meta.note}
        </div>
      </div>
      <b className={`shrink-0 text-sm ${meta.amountCls}`}>{meta.amount}</b>
    </>
  );
  return a.txHash && explorerUrl ? (
    <a href={`${explorerUrl}/tx/${a.txHash}`} target="_blank" rel="noreferrer" className="flex min-h-16 items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03]">
      {inner}
    </a>
  ) : (
    <div className="flex min-h-16 items-center gap-3 px-4 py-2.5">{inner}</div>
  );
}

type NextAction = { title: string; body: string; cta: string; href: string; external?: boolean };

function nextAction(data: DashboardData, t: ReturnType<typeof useI18n>["t"]): NextAction {
  const now = Date.now() / 1000;
  let best: { it: ItineraryView; s: StopView } | null = null;
  for (const it of data.active) {
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
      cta: t.dashOpenQr,
      href: `/itinerary/${best.it.id}`,
    };
  }
  const draft = data.drafts[0];
  if (draft) {
    return {
      title: fill(t.dashNextPay, { trip: draft.title }),
      body: fill(t.dashNextPayBody, { total: usdc(draft.totalUsdc) }),
      cta: t.dashPay,
      href: `/pay/${draft.id}`,
    };
  }
  if (data.balanceUsdc !== null && Number(data.balanceUsdc) < 1) {
    return { title: t.dashNextTopUp, body: t.dashNextTopUpBody, cta: t.dashTopUp, href: data.faucetUrl ?? "https://faucet.circle.com", external: true };
  }
  return { title: t.dashNextPlan, body: t.dashNextPlanBody, cta: t.dashNextPlanCta, href: "/#ask" };
}

export default function DashboardClient() {
  const { t } = useI18n();
  const [session, setSession] = useState<CircleSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTabState] = useState<Tab>("trips");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#wallet") setTabState("wallet");
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    history.replaceState(null, "", next === "wallet" ? "#wallet" : window.location.pathname);
  };

  const load = useCallback(
    async (s: CircleSession) => {
      setLoading(true);
      setError(null);
      try {
        let draftIds: string[] = [];
        try {
          const id = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as string | null;
          if (id) draftIds = [id];
        } catch {
          /* ignore */
        }
        const res = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userToken: s.userToken, draftIds }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = (j as { error?: { code?: string } }).error?.code ?? "";
          if (code === "UNAUTHORIZED") {
            const fresh = await getOrRefreshSession().catch(() => null);
            if (fresh && fresh.userToken !== s.userToken) return load(fresh);
            logout();
            setSession(null);
          }
          setError(t.err[code] ?? (j as { error?: { message?: string } }).error?.message ?? t.err.NETWORK);
          return;
        }
        setData(j as DashboardData);
      } catch {
        setError(t.err.NETWORK);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void (async () => {
      const s = await getOrRefreshSession().catch(() => null);
      setSession(s);
      setChecked(true);
      if (s) void load(s);
    })();
    const onChange = () => {
      const s = getSession();
      setSession(s);
      if (s) void load(s);
      else setData(null);
    };
    window.addEventListener(SESSION_EVENT, onChange);
    return () => window.removeEventListener(SESSION_EVENT, onChange);
  }, [load]);

  const connect = async () => {
    setError(null);
    if (!circleConfigured()) {
      setError(t.walletNotConfigured);
      return;
    }
    setConnecting(true);
    try {
      const s = await connectWallet("/dashboard");
      if (s) {
        setSession(s);
        void load(s);
      }
    } catch (err) {
      const code = err instanceof CircleClientError ? err.code : "";
      setError(t.err[code] ?? (err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const address = data?.wallet?.address ?? session?.walletAddress ?? null;
  const balance = data?.balanceUsdc !== undefined && data?.balanceUsdc !== null ? Number(data.balanceUsdc).toFixed(2) : null;
  const upcoming = useMemo(() => [...(data?.active ?? [])].sort((a, b) => (a.startAt < b.startAt ? -1 : 1)), [data]);
  const tripCount = (data?.drafts.length ?? 0) + (data?.active.length ?? 0) + (data?.history.length ?? 0);
  const next = data?.wallet ? nextAction(data, t) : null;
  const held = Number(data?.stats.escrowedUsdc ?? 0);
  const paidOut = Number(data?.stats.releasedUsdc ?? 0);
  const returned = Number(data?.stats.refundedUsdc ?? 0);
  const moneyTotal = held + paidOut + returned;

  const copyAddr = () => {
    if (!address) return;
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative overflow-x-clip">
      <div className="glow -top-[260px] -right-[100px] bg-[#28d7a4]" aria-hidden />
      <div className="mx-auto max-w-[900px] space-y-6 px-[18px] pt-6 pb-10 md:px-8 md:pt-10">
        {/* Title + balance shortcut */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] leading-tight font-extrabold text-white md:text-[36px]">{t.dashTitle}</h1>
            <p className="mt-1 text-sm text-ink-2">{t.dashSubtitle}</p>
          </div>
          {session && (
            <button
              type="button"
              onClick={() => setTab("wallet")}
              className="flex min-h-11 shrink-0 flex-col items-end justify-center rounded-xl border border-line bg-surface px-3 py-1.5 text-right"
            >
              <span className="text-[11px] text-ink-2">{t.dashBalance}</span>
              <b className="text-sm text-white">{balance !== null ? `${balance} USDC` : loading ? "…" : "—"}</b>
            </button>
          )}
        </header>

        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Not connected */}
        {checked && !session && (
          <section className="rounded-[24px] border border-line bg-surface p-6 text-center md:p-10">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#86ffd2] to-[#1ab884] text-2xl text-[#073526]">✦</div>
            <h2 className="mt-4 font-display text-xl font-extrabold text-white">{t.dashConnectTitle}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{t.dashConnectBody}</p>
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting}
              className="mt-5 min-h-12 rounded-xl bg-accent px-6 text-base font-bold text-accent-ink disabled:opacity-60"
            >
              {connecting ? t.connecting : t.connectWallet}
            </button>
          </section>
        )}

        {session && data && !data.wallet && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{t.dashNoWallet}</p>}

        {session && (
          <>
            {/* The one thing to do now */}
            {next ? (
              <section className="rounded-[24px] bg-gradient-to-br from-[#0f3a32] via-[#0b2a24] to-[#081d19] p-5 md:p-6">
                <div className="text-[11px] font-extrabold tracking-[2px] text-accent">{t.dashNext}</div>
                <h2 className="mt-2 font-display text-xl leading-snug font-extrabold text-white md:text-2xl">{next.title}</h2>
                <p className="mt-1.5 text-sm text-[#b8cdc6]">{next.body}</p>
                {next.external ? (
                  <a
                    href={next.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-accent px-5 text-base font-bold text-accent-ink"
                  >
                    {next.cta} ↗
                  </a>
                ) : (
                  <Link href={next.href} className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-accent px-5 text-base font-bold text-accent-ink">
                    {next.cta} →
                  </Link>
                )}
              </section>
            ) : (
              loading && <div className="h-[168px] animate-pulse rounded-[24px] bg-surface" />
            )}

            {/* Tabs */}
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1">
              {(
                [
                  ["trips", `${t.dashTabTrips}${tripCount ? ` (${tripCount})` : ""}`],
                  ["wallet", t.dashTabWallet],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`min-h-11 rounded-xl text-sm font-bold transition-colors ${tab === key ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "trips" && (
              <div className="space-y-6">
                {data && tripCount === 0 && <p className="rounded-[20px] border border-dashed border-[#2b4a43] p-5 text-sm text-ink-2">{t.dashNoTrips}</p>}
                {!data && loading && <div className="h-40 animate-pulse rounded-[20px] bg-surface" />}
                <Group title={t.dashUnpaid} count={data?.drafts.length ?? 0}>
                  {data?.drafts.map((it) => <TripCard key={it.id} it={it} kind="draft" />)}
                </Group>
                <Group title={t.dashUpcoming} count={upcoming.length}>
                  {upcoming.map((it) => <TripCard key={it.id} it={it} kind="active" />)}
                </Group>
                <Group title={t.dashPast} count={data?.history.length ?? 0}>
                  {data?.history.map((it) => <TripCard key={it.id} it={it} kind="past" />)}
                </Group>
                <Link
                  href="/#ask"
                  className="flex min-h-12 items-center justify-center gap-2 rounded-[20px] border border-dashed border-[#2b4a43] text-sm font-bold text-accent hover:bg-white/[0.03]"
                >
                  ✦ {t.dashNewTrip}
                </Link>
              </div>
            )}

            {tab === "wallet" && (
              <div className="space-y-6">
                {/* Balance */}
                <section className="rounded-[20px] border border-line bg-surface p-5">
                  <div className="text-xs text-ink-2">{t.usdcBalance} · Arc testnet</div>
                  <div className="mt-1 font-display text-[36px] leading-none font-extrabold text-white">
                    {balance ?? (loading ? "…" : "—")}
                    <span className="ml-2 text-base font-bold text-ink-2">USDC</span>
                  </div>
                  {address && (
                    <button
                      type="button"
                      onClick={copyAddr}
                      className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white/[0.06] px-3 font-mono text-xs text-[#dffff4]"
                      title={t.copy}
                    >
                      {shortAddr(address)} {copied ? "✓" : "⧉"}
                    </button>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <a
                      href={data?.faucetUrl ?? "https://faucet.circle.com"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center justify-center rounded-xl bg-accent px-3 text-sm font-bold text-accent-ink"
                    >
                      {t.dashTopUp} ↗
                    </a>
                    {address && data?.explorerUrl ? (
                      <a
                        href={`${data.explorerUrl}/address/${address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-11 items-center justify-center rounded-xl border border-line px-3 text-sm font-bold text-ink"
                      >
                        Explorer ↗
                      </a>
                    ) : (
                      <span />
                    )}
                  </div>
                </section>

                {/* Where the trip money is */}
                <section className="rounded-[20px] border border-line bg-surface p-5">
                  <h2 className="font-display text-base font-bold text-white">{t.dashMoneyTitle}</h2>
                  {moneyTotal > 0 ? (
                    <>
                      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <div className="bg-warn" style={{ width: `${(held / moneyTotal) * 100}%` }} />
                        <div className="bg-accent" style={{ width: `${(paidOut / moneyTotal) * 100}%` }} />
                        <div className="bg-[#6f8a82]" style={{ width: `${(returned / moneyTotal) * 100}%` }} />
                      </div>
                      <dl className="mt-3 space-y-2 text-sm">
                        {[
                          { dot: "bg-warn", label: t.dashHeld, value: held },
                          { dot: "bg-accent", label: t.dashPaidOut, value: paidOut },
                          { dot: "bg-[#6f8a82]", label: t.dashReturned, value: returned },
                        ].map((r) => (
                          <div key={r.label} className="flex items-center justify-between gap-3">
                            <dt className="flex items-center gap-2 text-[#c5d8d1]">
                              <i className={`inline-block h-2.5 w-2.5 rounded-full ${r.dot}`} />
                              {r.label}
                            </dt>
                            <dd className="font-bold text-white">{usdc(r.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-ink-2">{loading ? t.loading : t.dashMoneyEmpty}</p>
                  )}
                  <details className="group mt-4 rounded-xl bg-surface-2 px-4 open:pb-4">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-accent">
                      {t.dashHowTitle}
                      <span className="transition-transform group-open:rotate-180" aria-hidden>
                        ⌄
                      </span>
                    </summary>
                    <ol className="space-y-2.5 text-sm text-[#c5d8d1]">
                      {[t.dashHow1, t.dashHow2, t.dashHow3].map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                </section>

                {/* History */}
                <section className="space-y-3">
                  <h2 className="text-sm font-bold text-ink-2">{t.dashHistoryTitle}</h2>
                  {data?.activity.length ? (
                    <div className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
                      {data.activity.map((a, i) => (
                        <ActivityRow key={`${a.type}-${a.txHash ?? i}-${a.at}`} a={a} explorerUrl={data.explorerUrl} />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-[20px] border border-dashed border-[#2b4a43] p-5 text-sm text-ink-2">{loading ? t.loading : t.dashNoActivity}</p>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
