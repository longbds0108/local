"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleClientError,
  circleConfigured,
  ensureWallet,
  executeChallenge,
  getSession,
  logout,
  saveSession,
  startGoogleLogin,
  type CircleSession,
} from "@/lib/circle-client";
import { CATEGORY_EMOJI, hhmm, shortAddr, usdc } from "@/lib/format";
import type { ItineraryView } from "@/lib/types";
import { useI18n } from "./I18nProvider";
import { PriceLabel } from "./ItineraryCard";

type Phase =
  | "idle"
  | "login"
  | "creating"
  | "checking"
  | "approve"
  | "approveWait"
  | "deposit"
  | "confirming"
  | "done";

type Props = {
  initial: ItineraryView;
  explorerUrl: string | null;
  faucetUrl: string | null;
  feeEstimate: string | null;
  paymentsConfigured: boolean;
};

class FlowError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } }).error;
    throw new FlowError(e?.code ?? "HTTP_" + res.status, e?.message);
  }
  return json as T;
}

export default function PaymentPreview({ initial, explorerUrl, faucetUrl, feeEstimate, paymentsConfigured }: Props) {
  const { t } = useI18n();
  const [itinerary, setItinerary] = useState(initial);
  const [session, setSession] = useState<CircleSession | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(initial.status === "DRAFT" ? "idle" : "done");
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const paidStops = itinerary.stops.filter((s) => Number(s.priceUsdc) > 0);
  const isFree = paidStops.length === 0;

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const j = await api<{ usdc: string }>(`/api/balance?address=${addr}`);
      setBalance(j.usdc);
    } catch {
      setBalance(null);
    }
  }, []);

  const showError = useCallback(
    (err: unknown) => {
      const code = err instanceof FlowError || err instanceof CircleClientError ? err.code : "TX_FAILED";
      if (code === "UNAUTHORIZED") {
        logout();
        setSession(null);
      }
      setError(t.err[code] ?? (err as Error).message ?? t.err.TX_FAILED);
      setPhase("idle");
    },
    [t],
  );

  const pay = useCallback(
    async (s: CircleSession) => {
      setError(null);
      try {
        if (!s.walletAddress) {
          setPhase("creating");
          s = await ensureWallet(s);
          setSession(s);
        }
        const addr = s.walletAddress!;
        setPhase("checking");

        // Already deposited (e.g. page reloaded mid-flow)?
        const pre = await api<{ paid: boolean; itinerary?: ItineraryView }>("/api/itinerary/confirm", {
          method: "POST",
          body: JSON.stringify({ itineraryId: itinerary.id }),
        });
        if (pre.paid && pre.itinerary) {
          setItinerary(pre.itinerary);
          setPhase("done");
          return;
        }

        const status = await api<{ balanceOk: boolean; allowanceOk: boolean }>(
          `/api/circle/payment-status?itineraryId=${itinerary.id}&address=${addr}`,
        );
        if (!status.balanceOk) throw new FlowError("INSUFFICIENT_USDC");

        if (!status.allowanceOk) {
          setPhase("approve");
          const { challengeId } = await api<{ challengeId: string }>("/api/circle/deposit-challenge", {
            method: "POST",
            body: JSON.stringify({ userToken: s.userToken, itineraryId: itinerary.id, step: "approve" }),
          });
          await executeChallenge(s, challengeId);
          setPhase("approveWait");
          let ok = false;
          for (let i = 0; i < 45 && !ok; i++) {
            await sleep(2000);
            ok = (await api<{ allowanceOk: boolean }>(`/api/circle/payment-status?itineraryId=${itinerary.id}&address=${addr}`)).allowanceOk;
          }
          if (!ok) throw new FlowError("TIMEOUT_CHAIN");
        }

        setPhase("deposit");
        const { challengeId } = await api<{ challengeId: string }>("/api/circle/deposit-challenge", {
          method: "POST",
          body: JSON.stringify({ userToken: s.userToken, itineraryId: itinerary.id, step: "deposit" }),
        });
        await executeChallenge(s, challengeId);

        setPhase("confirming");
        for (let i = 0; i < 45; i++) {
          await sleep(2000);
          const r = await api<{ paid: boolean; itinerary?: ItineraryView }>("/api/itinerary/confirm", {
            method: "POST",
            body: JSON.stringify({ itineraryId: itinerary.id }),
          });
          if (r.paid && r.itinerary) {
            setItinerary(r.itinerary);
            setPhase("done");
            void refreshBalance(addr);
            return;
          }
        }
        throw new FlowError("TIMEOUT_CHAIN");
      } catch (err) {
        showError(err);
      }
    },
    [itinerary.id, refreshBalance, showError],
  );

  // Restore the Circle session; auto-continue after returning from Google login.
  useEffect(() => {
    const s = getSession();
    setSession(s);
    if (!s) return;
    if (s.walletAddress) void refreshBalance(s.walletAddress);
    const params = new URLSearchParams(window.location.search);
    if (params.get("autopay") === "1" && !autoStarted.current && initial.status === "DRAFT") {
      autoStarted.current = true;
      window.history.replaceState(null, "", window.location.pathname);
      void pay(s);
    } else if (!s.walletAddress) {
      setPhase("creating");
      ensureWallet(s)
        .then((next) => {
          setSession(next);
          setPhase("idle");
          void refreshBalance(next.walletAddress!);
        })
        .catch(showError);
    }
  }, [initial.status, pay, refreshBalance, showError]);

  const login = async () => {
    setError(null);
    setPhase("login");
    try {
      await startGoogleLogin(`/pay/${itinerary.id}?autopay=1`);
    } catch (err) {
      showError(err);
    }
  };

  const busy = phase !== "idle" && phase !== "done";
  const stepText: Record<Phase, string> = {
    idle: "",
    login: t.loggingIn,
    creating: t.creatingWallet,
    checking: t.stepCheck,
    approve: t.stepApprove,
    approveWait: t.stepApproveWait,
    deposit: t.stepDeposit,
    confirming: t.stepConfirm,
    done: "",
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-5">
      <Link href="/" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
        {t.backToMap}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">{t.payTitle}</h1>
        <span className="rounded-full bg-warn-soft px-3 py-1 text-xs font-semibold text-warn">⚠️ {t.testnetBadge}</span>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-semibold text-ink">{itinerary.title}</h2>
        <p className="text-xs text-ink-2">
          {hhmm(itinerary.startAt)}–{hhmm(itinerary.endAt)} · {itinerary.partySize} {t.people}
        </p>
        <ul className="mt-3 divide-y divide-line">
          {itinerary.stops.map((s, i) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">
                  {i + 1}. {CATEGORY_EMOJI[s.category] ?? "📍"} {s.name}
                </div>
                <div className="text-xs text-ink-2">{hhmm(s.arriveAt)}</div>
              </div>
              <PriceLabel price={s.priceUsdc} source={s.priceSource} />
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-2">{t.total}</dt>
            <dd className="text-lg font-bold text-ink">{usdc(itinerary.totalUsdc)}</dd>
          </div>
          <div className="flex justify-between text-xs">
            <dt className="text-ink-2">
              {t.networkFee} <span className="opacity-80">({t.feeNote})</span>
            </dt>
            <dd className="text-ink-2">{feeEstimate ? `~${Number(feeEstimate).toFixed(4)} USDC` : "—"}</dd>
          </div>
        </dl>
        <p className="mt-3 rounded-xl bg-surface-2 p-3 text-xs text-ink-2">🔒 {t.escrowExplain}</p>
      </section>

      {phase === "done" ? (
        <section className="space-y-3 rounded-2xl border border-ok/40 bg-ok-soft p-4">
          <h2 className="text-lg font-bold text-ok">✅ {t.paidTitle}</h2>
          {itinerary.depositTxHash && (
            <p className="text-sm break-all text-ink">
              {t.txHash}: <code className="text-xs">{itinerary.depositTxHash}</code>
              {explorerUrl && (
                <>
                  {" "}
                  <a className="font-semibold text-accent underline" href={`${explorerUrl}/tx/${itinerary.depositTxHash}`} target="_blank" rel="noreferrer">
                    {t.viewOnExplorer} ↗
                  </a>
                </>
              )}
            </p>
          )}
          <Link href={`/itinerary/${itinerary.id}`} className="inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
            {t.viewVouchers} →
          </Link>
        </section>
      ) : isFree ? (
        <p className="rounded-2xl bg-surface-2 p-4 text-sm text-ink">{t.freeItinerary}</p>
      ) : !paymentsConfigured || !circleConfigured() ? (
        <p role="alert" className="rounded-2xl bg-danger/10 p-4 text-sm text-danger">
          {t.paymentsNotConfigured}
        </p>
      ) : (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          {session?.walletAddress && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <div className="text-xs text-ink-2">{t.wallet}</div>
                <button
                  type="button"
                  className="font-mono text-ink hover:text-accent"
                  title={t.copy}
                  onClick={() => navigator.clipboard?.writeText(session.walletAddress!)}
                >
                  {shortAddr(session.walletAddress)} ⧉
                </button>
              </div>
              <div className="text-right">
                <div className="text-xs text-ink-2">{t.balance}</div>
                <div className="font-semibold text-ink">{balance !== null ? usdc(Number(balance).toFixed(2)) : "—"}</div>
              </div>
            </div>
          )}
          {faucetUrl && (
            <a href={faucetUrl} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium text-accent underline">
              🚰 {t.faucet} ↗
            </a>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {stepText[phase]}
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => (session ? void pay(session) : void login())}
            className="min-h-[48px] w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink disabled:opacity-50"
          >
            {session ? `${t.pay} ${usdc(itinerary.totalUsdc)}` : t.loginAndPay}
          </button>
          {session && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                logout();
                saveSession(null);
                setSession(null);
                setBalance(null);
              }}
              className="w-full text-center text-xs text-ink-2 hover:underline"
            >
              {t.logout}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
