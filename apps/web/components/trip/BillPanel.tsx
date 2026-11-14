"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleClientError,
  connectWallet,
  ensureWallet,
  executeChallenge,
  getOrRefreshSession,
  getSession,
  logout,
  SESSION_EVENT,
} from "@/lib/circle-client";
import { errorText } from "@/lib/error-text";
import { shortAddr, usdc } from "@/lib/format";
import { merchantName } from "@/lib/i18n";
import type { ItineraryView, StopView } from "@/lib/types";
import { useI18n } from "../I18nProvider";

class Fail extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (j as { error?: { code?: string; message?: string } }).error;
    throw new Fail(e?.code ?? "HTTP_" + res.status, e?.message);
  }
  return j as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const cents = (s: string) => Math.round(Number(s.replace(",", ".")) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

/** The signed-in wallet, following connects made elsewhere on the page. */
function useViewer() {
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setViewer(getSession()?.walletAddress ?? null);
    read();
    window.addEventListener(SESSION_EVENT, read);
    return () => window.removeEventListener(SESSION_EVENT, read);
  }, []);
  return viewer;
}

/**
 * A pay-at-venue stop on a group trip: enter the bill and split it (equal by seats,
 * editable), then each member pays their own part straight to the venue.
 */
export default function BillPanel({ it, stop, onChanged }: { it: ItineraryView; stop: StopView; onChanged: (it?: ItineraryView) => void }) {
  const { t } = useI18n();
  const viewer = useViewer();
  const members = useMemo(() => (it.group?.shares ?? []).filter((s) => s.status !== "PENDING"), [it.group]);
  const bill = it.group?.bills.find((b) => b.stopId === stop.id) ?? null;
  const [redo, setRedo] = useState(false);
  const creating = !bill || redo;

  const [total, setTotal] = useState(Number(stop.priceUsdc) > 0 ? Number(stop.priceUsdc).toFixed(2) : "");
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const on = (addr: string) => included[addr.toLowerCase()] !== false;
  // Equal split by seats; the last person absorbs the rounding so the parts add up exactly.
  const evenSplit = useCallback(() => {
    const totalC = cents(total || "0");
    const chosen = members.filter((m) => included[m.payerAddress.toLowerCase()] !== false);
    const seats = chosen.reduce((n, m) => n + m.people, 0);
    const next: Record<string, string> = {};
    let used = 0;
    chosen.forEach((m, i) => {
      const c = i === chosen.length - 1 ? totalC - used : Math.floor((totalC * m.people) / Math.max(1, seats));
      used += c;
      next[m.payerAddress.toLowerCase()] = fromCents(Math.max(0, c));
    });
    setAmounts(next);
    setEdited(false);
  }, [total, members, included]);
  useEffect(() => {
    if (creating && !edited) evenSplit();
  }, [creating, edited, evenSplit]);

  const chosen = members.filter((m) => on(m.payerAddress));
  const sumC = chosen.reduce((s, m) => s + cents(amounts[m.payerAddress.toLowerCase()] ?? "0"), 0);
  const totalC = cents(total || "0");
  const valid = totalC > 0 && chosen.length > 0 && sumC === totalC && chosen.every((m) => cents(amounts[m.payerAddress.toLowerCase()] ?? "0") > 0);

  const fail = useCallback(
    (err: unknown) => {
      const code = err instanceof Fail || err instanceof CircleClientError ? err.code : "NETWORK";
      if (code === "UNAUTHORIZED") logout();
      setError(code === "NETWORK" ? t.err.NETWORK : errorText(t, code, (err as Error).message));
      setBusy(null);
    },
    [t],
  );

  const session = async () => {
    let s = await getOrRefreshSession().catch(() => null);
    if (!s) s = await connectWallet(`/trips/${it.id}`);
    if (!s) return null;
    if (!s.walletAddress) s = await ensureWallet(s);
    return s;
  };

  const create = async () => {
    setError(null);
    setBusy(t.groupWorking);
    try {
      const s = await session();
      if (!s) return setBusy(null);
      const r = await post<{ itinerary: ItineraryView }>("/api/group/bill", {
        userToken: s.userToken,
        stopId: stop.id,
        merchantId: stop.merchant?.id,
        totalUsdc: fromCents(totalC),
        parts: chosen.map((m) => ({ payerAddress: m.payerAddress, amountUsdc: fromCents(cents(amounts[m.payerAddress.toLowerCase()])) })),
      });
      setRedo(false);
      setBusy(null);
      onChanged(r.itinerary);
    } catch (err) {
      fail(err);
    }
  };

  const payMine = async () => {
    setError(null);
    setBusy(t.groupWorking);
    try {
      const s = await session();
      if (!s) return setBusy(null);
      const { challengeId } = await post<{ challengeId: string }>("/api/group/bill/pay", { userToken: s.userToken, stopId: stop.id });
      await executeChallenge(s, challengeId);
      setBusy(t.groupConfirming);
      for (let i = 0; i < 45; i++) {
        const r = await post<{ itinerary: ItineraryView }>("/api/group/bill/confirm", { stopId: stop.id });
        const part = r.itinerary.group?.bills.find((b) => b.stopId === stop.id)?.parts.find((p) => same(p.payerAddress, s.walletAddress));
        if (part?.status === "PAID") {
          setBusy(null);
          onChanged(r.itinerary);
          return;
        }
        await sleep(2000);
      }
      throw new Fail("TIMEOUT_CHAIN");
    } catch (err) {
      fail(err);
    }
  };

  // A part paid earlier (page closed mid-way)? Look for it on-chain once.
  const started = bill?.parts.some((p) => p.status === "PENDING" && p.started);
  useEffect(() => {
    if (!started) return;
    void post<{ itinerary: ItineraryView }>("/api/group/bill/confirm", { stopId: stop.id })
      .then((r) => onChanged(r.itinerary))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, stop.id]);

  const who = (addr: string) => (same(addr, viewer) ? t.groupYou : shortAddr(addr));
  const venue = merchantName(t, stop.merchant) || stop.name;
  const inputCls = "h-11 w-full min-w-0 rounded-xl border border-[#2c4b45] bg-bg px-3 text-sm text-white tabular-nums outline-none focus:border-accent";

  if (creating) {
    return (
      <div className="space-y-3 rounded-xl bg-bg/60 p-3">
        <h3 className="font-semibold text-white">{t.billAt.replace("{name}", venue)}</h3>
        <label className="block space-y-1">
          <span className="text-xs text-ink-2">{t.billTotal}</span>
          <input value={total} onChange={(e) => { setTotal(e.target.value); setEdited(false); }} inputMode="decimal" placeholder="0.00" className={inputCls} />
        </label>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-2">{t.billWho}</span>
            <button type="button" onClick={evenSplit} className="min-h-9 text-xs font-semibold text-accent">
              {t.billEven}
            </button>
          </div>
          {members.map((m) => {
            const key = m.payerAddress.toLowerCase();
            return (
              <div key={key} className="flex items-center gap-2">
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={on(m.payerAddress)}
                    onChange={(e) => { setIncluded((x) => ({ ...x, [key]: e.target.checked })); setEdited(false); }}
                    className="h-4 w-4 accent-[#70efc0]"
                  />
                  <span className="truncate">
                    {who(m.payerAddress)} <span className="text-ink-2">· {m.people} {m.people === 1 ? t.person : t.people}</span>
                  </span>
                </label>
                <input
                  value={on(m.payerAddress) ? (amounts[key] ?? "") : ""}
                  disabled={!on(m.payerAddress)}
                  onChange={(e) => { setAmounts((x) => ({ ...x, [key]: e.target.value })); setEdited(true); }}
                  inputMode="decimal"
                  className="h-11 w-24 shrink-0 rounded-xl border border-[#2c4b45] bg-bg px-3 text-right text-sm text-white tabular-nums outline-none focus:border-accent disabled:opacity-40"
                  aria-label={who(m.payerAddress)}
                />
              </div>
            );
          })}
          <p className={`text-right text-xs ${sumC === totalC ? "text-ink-2" : "text-warn"}`}>
            {t.billSum.replace("{sum}", usdc(fromCents(sumC))).replace("{total}", usdc(fromCents(totalC)))}
          </p>
        </div>
        <p className="text-xs leading-relaxed text-ink-2">{t.billSplitHint}</p>
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {busy && <p role="status" className="text-sm text-accent">{busy}</p>}
        <button
          type="button"
          onClick={() => void create()}
          disabled={!valid || !!busy}
          className="min-h-12 w-full rounded-xl bg-accent text-sm font-bold text-accent-ink disabled:opacity-50"
        >
          {t.billCreate}
        </button>
      </div>
    );
  }

  const mine = bill!.parts.find((p) => same(p.payerAddress, viewer));
  const paidCount = bill!.parts.filter((p) => p.status === "PAID").length;
  const canRedo = same(bill!.createdBy, viewer) && !bill!.parts.some((p) => p.status === "PAID" || p.started);
  return (
    <div className="space-y-3 rounded-xl bg-bg/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">{t.billAt.replace("{name}", venue)}</h3>
          <p className="text-xs text-ink-2">{usdc(bill!.totalUsdc)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent tabular-nums">
          {t.groupProgress.replace("{paid}", String(paidCount)).replace("{total}", String(bill!.parts.length))}
        </span>
      </div>
      <ul className="divide-y divide-line rounded-lg bg-surface-2">
        {bill!.parts.map((p) => (
          <li key={p.payerAddress} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate text-ink">{who(p.payerAddress)}</span>
            <span className="shrink-0 tabular-nums text-white">{usdc(p.amountUsdc)}</span>
            <span className={`w-16 shrink-0 text-right text-xs font-semibold ${p.status === "PAID" ? "text-accent" : "text-warn"}`}>
              {p.status === "PAID" ? t.billPaid : t.billUnpaid}
            </span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {busy && <p role="status" className="text-sm text-accent">{busy}</p>}
      {stop.status === "RELEASED" || paidCount === bill!.parts.length ? (
        <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">✓ {t.billDone}</p>
      ) : mine?.status === "PAID" ? (
        <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">✓ {t.billMinePaid}</p>
      ) : mine ? (
        <button
          type="button"
          onClick={() => void payMine()}
          disabled={!!busy}
          className="min-h-12 w-full rounded-xl bg-accent text-sm font-bold text-accent-ink disabled:opacity-50"
        >
          {t.groupPayMine.replace("{amount}", usdc(mine.amountUsdc))}
        </button>
      ) : (
        <p className="text-xs text-ink-2">{t.billNotOnIt}</p>
      )}
      {canRedo && !busy && (
        <button type="button" onClick={() => setRedo(true)} className="min-h-10 text-xs font-semibold text-ink-2 underline hover:text-white">
          {t.billRedo}
        </button>
      )}
    </div>
  );
}
