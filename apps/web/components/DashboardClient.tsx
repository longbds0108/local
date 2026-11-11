"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import { CATEGORY_EMOJI, dayLabel, hhmm, shortAddr, usdc } from "@/lib/format";
import type { DashboardActivity, DashboardData, ItineraryView } from "@/lib/types";
import { useI18n } from "./I18nProvider";

const DRAFT_KEY = "hedgora.chat.itinerary";

function TripCard({ it, kind }: { it: ItineraryView; kind: "draft" | "active" | "history" }) {
  const { t, locale } = useI18n();
  const paid = it.stops.filter((s) => s.status !== "FREE");
  const done = paid.filter((s) => s.status === "RELEASED" || s.status === "REFUNDED").length;
  const pct = paid.length ? Math.round((done / paid.length) * 100) : 0;
  const href = kind === "draft" ? `/pay/${it.id}` : `/itinerary/${it.id}`;
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold text-white">{it.title}</h3>
          <p className="mt-0.5 text-xs text-ink-2">
            {dayLabel(it.startAt, locale)} · {hhmm(it.startAt)}–{hhmm(it.endAt)} · {it.partySize} {t.people}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent">{t.status[it.status]}</span>
      </div>
      <p className="mt-3 truncate text-sm text-[#c5d8d1]">
        {it.stops.map((s) => `${CATEGORY_EMOJI[s.category] ?? "📍"} ${s.name}`).join("  ·  ")}
      </p>
      {kind === "active" && paid.length > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-ink-2">
            <span>{t.dashCheckins.replace("{done}", String(done)).replace("{total}", String(paid.length))}</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <b className="text-lg text-white">{usdc(it.totalUsdc)}</b>
        <Link
          href={href}
          className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${
            kind === "history" ? "border border-line text-ink" : "bg-accent text-accent-ink"
          }`}
        >
          {kind === "draft" ? t.viewPayment : kind === "active" ? t.viewVouchers : t.dashDetails} →
        </Link>
      </div>
    </article>
  );
}

function ActivityRow({ a, explorerUrl }: { a: DashboardActivity; explorerUrl: string | null }) {
  const { t, locale } = useI18n();
  const meta = {
    deposit: { icon: "↓", label: t.dashDeposit, sign: "−", cls: "bg-[#13342d] text-accent" },
    release: { icon: "↗", label: t.dashRelease, sign: "", cls: "bg-[#2a2a14] text-warn" },
    refund: { icon: "↩", label: t.dashRefund, sign: "+", cls: "bg-[#13342d] text-accent" },
  }[a.type];
  const inner = (
    <>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg font-bold ${meta.cls}`} aria-hidden>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">
          {meta.label} · {a.title}
        </div>
        <div className="truncate text-xs text-ink-2">
          {dayLabel(a.at, locale)} {hhmm(a.at)}
          {a.merchant ? ` · ${a.merchant}` : ""}
          {a.txHash ? ` · ${a.txHash.slice(0, 8)}…` : ""}
        </div>
      </div>
      <b className="shrink-0 text-sm text-white">
        {meta.sign}
        {usdc(a.amountUsdc)}
      </b>
    </>
  );
  return a.txHash && explorerUrl ? (
    <a href={`${explorerUrl}/tx/${a.txHash}`} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-white/[0.03]">
      {inner}
    </a>
  ) : (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">{inner}</div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-white md:text-xl">
        {title}
        {count !== undefined && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

export default function DashboardClient() {
  const { t } = useI18n();
  const [session, setSession] = useState<CircleSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  return (
    <div className="relative overflow-x-clip">
      <div className="glow -top-[260px] -right-[100px] bg-[#28d7a4]" aria-hidden />
      <div className="mx-auto max-w-[1100px] space-y-8 px-[18px] pt-6 pb-10 md:px-8 md:pt-10">
        <header>
          <div className="text-[11px] font-extrabold tracking-[2px] text-accent">✦ {t.dashEyebrow}</div>
          <h1 className="mt-2 font-display text-[30px] leading-tight font-extrabold text-white md:text-[40px]">{t.dashTitle}</h1>
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

        {session && (
          <>
            {/* Wallet + stats */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-[1.1fr_1.4fr]">
              <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#0f3a32] via-[#0b2a24] to-[#081d19] p-5 md:p-6">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-[1.5px] text-[#84a59b]">
                  <i className="inline-block h-2 w-2 rounded-full bg-accent" /> {t.travelWallet} · ARC TESTNET
                </div>
                <div className="mt-4 text-xs text-ink-2">{t.usdcBalance}</div>
                <div className="font-display text-[40px] leading-none font-extrabold text-white">
                  {data?.balanceUsdc !== undefined && data?.balanceUsdc !== null ? Number(data.balanceUsdc).toFixed(2) : loading ? "…" : "—"}
                  <span className="ml-2 text-base font-bold text-ink-2">USDC</span>
                </div>
                {address && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(address)}
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white/[0.06] px-3 font-mono text-xs text-[#dffff4]"
                    title={t.copy}
                  >
                    {shortAddr(address)} ⧉
                  </button>
                )}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <a
                    href={data?.faucetUrl ?? "https://faucet.circle.com"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-11 items-center justify-center rounded-xl bg-accent px-3 text-sm font-bold text-accent-ink"
                  >
                    🚰 {t.dashTopUp}
                  </a>
                  <Link href="/#ask" className="flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-3 text-sm font-bold text-white">
                    ✦ {t.dashNewTrip}
                  </Link>
                </div>
                {address && data?.explorerUrl && (
                  <a
                    href={`${data.explorerUrl}/address/${address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex min-h-10 items-center text-xs font-semibold text-accent underline"
                  >
                    {t.viewOnExplorer} ↗
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: t.dashEscrowed, value: usdc(data?.stats.escrowedUsdc ?? 0), hint: t.dashEscrowedHint, icon: "🔒" },
                  { label: t.dashReleased, value: usdc(data?.stats.releasedUsdc ?? 0), hint: t.dashReleasedHint, icon: "↗" },
                  { label: t.dashRefunded, value: usdc(data?.stats.refundedUsdc ?? 0), hint: t.dashRefundedHint, icon: "↩" },
                  { label: t.dashTrips, value: String(data?.stats.trips ?? 0), hint: t.dashVouchers.replace("{n}", String(data?.stats.activeVouchers ?? 0)), icon: "◇" },
                ].map((s) => (
                  <div key={s.label} className="rounded-[20px] border border-line bg-surface p-4">
                    <div className="flex items-center justify-between text-xs text-ink-2">
                      <span>{s.label}</span>
                      <span aria-hidden>{s.icon}</span>
                    </div>
                    <div className={`mt-2 font-display text-xl font-extrabold text-white md:text-2xl ${loading && !data ? "animate-pulse" : ""}`}>{s.value}</div>
                    <div className="mt-1 text-[11px] leading-snug text-ink-2">{s.hint}</div>
                  </div>
                ))}
              </div>
            </section>

            {data && !data.wallet && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{t.dashNoWallet}</p>}

            {data?.drafts.length ? (
              <Section title={t.dashPlanning} count={data.drafts.length}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {data.drafts.map((it) => (
                    <TripCard key={it.id} it={it} kind="draft" />
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title={t.dashActive} count={data?.active.length ?? 0}>
              {data?.active.length ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {data.active.map((it) => (
                    <TripCard key={it.id} it={it} kind="active" />
                  ))}
                </div>
              ) : (
                <div className="rounded-[20px] border border-dashed border-[#2b4a43] p-5 text-sm text-ink-2">
                  {loading ? t.loading : t.dashNoActive}{" "}
                  {!loading && (
                    <Link href="/#ask" className="font-semibold text-accent underline">
                      {t.askButton} →
                    </Link>
                  )}
                </div>
              )}
            </Section>

            {data?.history.length ? (
              <Section title={t.dashHistory} count={data.history.length}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {data.history.map((it) => (
                    <TripCard key={it.id} it={it} kind="history" />
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title={t.dashActivity}>
              {data?.activity.length ? (
                <div className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
                  {data.activity.map((a, i) => (
                    <ActivityRow key={`${a.type}-${a.txHash ?? i}-${a.at}`} a={a} explorerUrl={data.explorerUrl} />
                  ))}
                </div>
              ) : (
                <p className="rounded-[20px] border border-dashed border-[#2b4a43] p-5 text-sm text-ink-2">{loading ? t.loading : t.dashNoActivity}</p>
              )}
            </Section>

            <p className="text-center text-xs text-ink-2">
              {t.dashMerchantHint}{" "}
              <Link href="/merchant" className="inline-flex min-h-10 items-center font-semibold text-accent underline">
                {t.merchantTitle} →
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
