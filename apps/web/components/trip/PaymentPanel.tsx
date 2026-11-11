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
  authMode,
  connectWallet,
  getOrRefreshSession,
  SESSION_EVENT,
  type CircleSession,
} from "@/lib/circle-client";
import { CATEGORY_EMOJI, hhmm, shortAddr, usdc } from "@/lib/format";
import type { ItineraryView } from "@/lib/types";
import { useI18n } from "../I18nProvider";
import { PriceLabel } from "../ItineraryCard";
import { errorText } from "@/lib/error-text";
import { isExpiredDraft } from "@/lib/use-account";

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
  faucetUrl: string | null;
  feeEstimate: string | null;
  paymentsConfigured: boolean;
  /** Called once the deposit is confirmed; the trip page then reloads into its QR step. */
  onPaid: () => void;
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

/** Unpaid trip: the plan with prices, then the one payment action. */
export default function PaymentPanel({ initial, faucetUrl, feeEstimate, paymentsConfigured, onPaid }: Props) {
  const { t } = useI18n();
  const [itinerary, setItinerary] = useState(initial);
  const [session, setSession] = useState<CircleSession | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(initial.status === "DRAFT" ? "idle" : "done");
  useEffect(() => {
    if (phase === "done") onPaid();
  }, [phase, onPaid]);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const paidStops = itinerary.stops.filter((s) => Number(s.priceUsdc) > 0);
  const isFree = paidStops.length === 0;

  const refreshBalance = useCallback(async (addr: string): Promise<number | null> => {
    try {
      const j = await api<{ usdc: string }>(`/api/balance?address=${addr}`);
      setBalance(j.usdc);
      return Number(j.usdc);
    } catch {
      setBalance(null);
      return null;
    }
  }, []);

  // What the wallet must hold: the trip plus the network fee (gas is paid in USDC on Arc).
  const need = Number(itinerary.totalUsdc) + (feeEstimate ? Number(feeEstimate) : 0);
  const short = session?.walletAddress && balance !== null ? Math.max(0, need - Number(balance)) : 0;
  const expired = isExpiredDraft(itinerary);
  const [copied, setCopied] = useState(false);

  // While short of USDC, watch the balance so the page unlocks by itself after a top-up.
  useEffect(() => {
    if (!(short > 0) || phase !== "idle" || !session?.walletAddress) return;
    const addr = session.walletAddress;
    const timer = setInterval(() => void refreshBalance(addr), 8000);
    return () => clearInterval(timer);
  }, [short, phase, session?.walletAddress, refreshBalance]);

  const showError = useCallback(
    (err: unknown) => {
      const code = err instanceof FlowError || err instanceof CircleClientError ? err.code : "TX_FAILED";
      if (code === "UNAUTHORIZED") {
        logout();
        setSession(null);
      }
      setError(errorText(t, code, (err as Error).message));
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
        if (!status.balanceOk) {
          // Show the top-up steps instead of an error; they explain what to do.
          const now = await refreshBalance(addr);
          if (now === null || now >= need) throw new FlowError("INSUFFICIENT_USDC");
          setPhase("idle");
          return;
        }

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
    [itinerary.id, need, refreshBalance, showError],
  );

  // Follow connects/disconnects made elsewhere (e.g. the header wallet button).
  useEffect(() => {
    const read = () => {
      const s = getSession();
      setSession(s);
      if (s?.walletAddress) void refreshBalance(s.walletAddress);
    };
    window.addEventListener(SESSION_EVENT, read);
    return () => window.removeEventListener(SESSION_EVENT, read);
  }, [refreshBalance]);

  // Restore the Circle session (PIN sessions renew silently); auto-continue after Google login.
  useEffect(() => {
    void (async () => {
    const s = await getOrRefreshSession().catch(() => null);
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
    })();
  }, [initial.status, pay, refreshBalance, showError]);

  // PIN mode: connect in place (Circle UI asks for the PIN) then pay.
  // Google mode: redirect to Google; payment resumes via ?autopay=1.
  const login = async () => {
    setError(null);
    setPhase(authMode() === "pin" ? "creating" : "login");
    try {
      const s = await connectWallet(`/trips/${itinerary.id}?autopay=1`);
      if (!s) return;
      setSession(s);
      if (s.walletAddress) void refreshBalance(s.walletAddress);
      await pay(s);
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
    <div className="space-y-5">
      {expired && (
        <section className="rounded-[20px] border border-line bg-surface p-4">
          <h2 className="font-bold text-white">{t.draftExpiredTitle}</h2>
          <p className="mt-1 text-sm text-ink-2">{t.draftExpiredBody}</p>
          <Link href="/#ask" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink">
            ✦ {t.dashReplan} →
          </Link>
        </section>
      )}
      <section className="rounded-[20px] border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink-2">{t.tripStops}</h2>
          <Link href="/#ask" className="inline-flex min-h-10 items-center text-sm font-semibold text-accent hover:underline">
            ✦ {t.editWithAi}
          </Link>
        </div>
        <ul className="mt-1 divide-y divide-line">
          {itinerary.stops.map((s, i) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">
                  {i + 1}. {CATEGORY_EMOJI[s.category] ?? "📍"} {s.name}
                </div>
                <div className="text-xs text-ink-2">
                  {hhmm(s.arriveAt)} · {s.durationMin} {t.minutes}
                </div>
              </div>
              <PriceLabel price={s.priceUsdc} source={s.priceSource} />
            </li>
          ))}
        </ul>
        {!expired && (
        <>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-2">{t.total}</dt>
            <dd className="text-lg font-bold text-ink">{usdc(itinerary.totalUsdc)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-ink-2">
              {t.networkFee}
              <span className="block opacity-80">{t.feeNote}</span>
            </dt>
            <dd className="shrink-0 whitespace-nowrap text-ink-2">{feeEstimate ? `~${Number(feeEstimate).toFixed(4)} USDC` : "—"}</dd>
          </div>
        </dl>
        <p className="mt-3 rounded-xl bg-surface-2 p-3 text-xs text-ink-2">🔒 {t.escrowExplain}</p>
        </>
        )}
      </section>

      {phase === "done" ? (
        <section role="status" className="flex items-center gap-3 rounded-[20px] border border-ok/40 bg-ok-soft p-4">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ok border-t-transparent" />
          <div>
            <h2 className="font-bold text-ok">✅ {t.paidTitle}</h2>
            <p className="text-sm text-ink">{t.openingQr}</p>
          </div>
        </section>
      ) : expired ? null : isFree ? (
        <p className="rounded-2xl bg-surface-2 p-4 text-sm text-ink">{t.freeItinerary}</p>
      ) : !paymentsConfigured || !circleConfigured() ? (
        <p role="alert" className="rounded-2xl bg-danger/10 p-4 text-sm text-danger">
          {t.paymentsNotConfigured}
        </p>
      ) : (
        <section className="space-y-3 rounded-[20px] border border-line bg-surface p-4">
          {session?.walletAddress && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <div className="text-xs text-ink-2">{t.wallet}</div>
                <button
                  type="button"
                  className="min-h-10 tabular-nums text-ink hover:text-accent"
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
          {short > 0 && !busy && (
            <div className="space-y-3 rounded-xl border border-warn/40 bg-warn-soft p-4">
              <div>
                <b className="text-warn">{t.shortTitle.replace("{amount}", usdc(short.toFixed(2)))}</b>
                <p className="mt-0.5 text-xs text-[#e8dcc2]">
                  {t.shortBody.replace("{balance}", usdc(Number(balance).toFixed(2))).replace("{need}", usdc(need.toFixed(2)))}
                </p>
              </div>
              <ol className="space-y-2.5 text-sm text-ink">
                <li className="flex items-start gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-warn/20 text-xs font-bold text-warn">1</span>
                  <div className="min-w-0 flex-1">
                    {t.shortStep1}
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(session!.walletAddress!).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        })
                      }
                      className="mt-1.5 flex min-h-10 w-full items-center justify-between gap-2 rounded-lg bg-bg/60 px-3 text-xs tabular-nums"
                    >
                      <span className="truncate">{session!.walletAddress}</span>
                      <span className="shrink-0 font-bold text-accent">{copied ? `✓ ${t.copied}` : t.copy}</span>
                    </button>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-warn/20 text-xs font-bold text-warn">2</span>
                  <div className="min-w-0 flex-1">
                    {t.shortStep2}
                    <a
                      href={faucetUrl ?? "https://faucet.circle.com"}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 flex min-h-10 items-center justify-center rounded-lg bg-accent px-3 text-sm font-bold text-accent-ink"
                    >
                      {t.faucet} ↗
                    </a>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-warn/20 text-xs font-bold text-warn">3</span>
                  <span className="flex items-center gap-2">
                    {t.shortStep3}
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-warn border-t-transparent" aria-hidden />
                  </span>
                </li>
              </ol>
            </div>
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
            disabled={busy || short > 0}
            onClick={() => (session ? void pay(session) : void login())}
            className="min-h-[48px] w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink disabled:opacity-50"
          >
            {short > 0
              ? t.payNeedMore.replace("{amount}", usdc(short.toFixed(2)))
              : session
                ? `${t.pay} ${usdc(itinerary.totalUsdc)}`
                : authMode() === "pin"
                  ? t.connectAndPay
                  : t.loginAndPay}
          </button>
          {!busy && short === 0 && <p className="text-center text-xs text-ink-2">{session ? t.payConfirmNote : t.payHowNote}</p>}
        </section>
      )}
    </div>
  );
}
