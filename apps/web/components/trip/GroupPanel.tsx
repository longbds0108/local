"use client";

import { useCallback, useEffect, useState } from "react";
import { codeHashes, ensureCodes } from "@/lib/checkin-codes";
import {
  CircleClientError,
  connectWallet,
  ensureWallet,
  executeChallenge,
  getOrRefreshSession,
  logout,
} from "@/lib/circle-client";
import { errorText } from "@/lib/error-text";
import { hhmm, shortAddr, tripDay, usdc } from "@/lib/format";
import { isOrganizer, myShare } from "@/lib/group-view";
import type { ItineraryView } from "@/lib/types";
import { useI18n } from "../I18nProvider";
import QRVoucher from "../QRVoucher";
import BillPanel from "./BillPanel";

class Fail extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function api<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (j as { error?: { code?: string; message?: string } }).error;
    throw new Fail(e?.code ?? "HTTP_" + res.status, e?.message);
  }
  return j as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A group trip: who has paid, the invite link, and paying your own share. */
export default function GroupPanel({
  it,
  viewer,
  onChange,
  paymentsConfigured,
}: {
  it: ItineraryView;
  viewer: string | null;
  onChange: (it: ItineraryView) => void;
  paymentsConfigured: boolean;
}) {
  const { t } = useI18n();
  const g = it.group!;
  const mine = myShare(it, viewer);
  const paidMine = !!mine && mine.status !== "PENDING";
  const organizer = isOrganizer(it, viewer);
  const left = Math.max(0, it.partySize - g.paidPeople);
  // Prepaid trips: members join by paying their share before the trip starts.
  // Trips paid only at venues: members just join (until the trip ends) and split each bill.
  const hasPrepay = Number(g.perPersonUsdc) > 0;
  const hasVenue = it.stops.some((s) => s.payMode === "VENUE");
  const closesAt = new Date(hasPrepay ? it.startAt : it.endAt).getTime();
  const open = (it.status === "DRAFT" || it.status === "PAID") && closesAt > Date.now() && left > 0;
  const [people, setPeople] = useState(1);
  useEffect(() => setPeople((p) => Math.min(Math.max(1, p), Math.max(1, left))), [left]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setLink(`${window.location.origin}/trips/${it.id}`), [it.id]);

  const per = Number(g.perPersonUsdc);
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
    if (!s) return null; // Google sign-in: the page comes back here afterwards
    if (!s.walletAddress) s = await ensureWallet(s);
    return s;
  };

  const pay = async () => {
    setError(null);
    setBusy(t.groupWorking);
    try {
      const s = await session();
      if (!s) return setBusy(null);
      // One code per prepaid stop, made and kept on this device; only their hashes leave it.
      const ids = it.stops.filter((x) => x.payMode === "ESCROW" && x.status === "PENDING").map((x) => x.id);
      let hashes: Record<string, string>;
      try {
        hashes = codeHashes(ensureCodes(it.id, ids));
      } catch {
        throw new Fail("STORAGE");
      }
      const { challengeId } = await api<{ challengeId: string }>("/api/group/pay", {
        userToken: s.userToken,
        itineraryId: it.id,
        people,
        codeHashes: hashes,
      });
      await executeChallenge(s, challengeId);
      setBusy(t.groupConfirming);
      for (let i = 0; i < 45; i++) {
        const r = await api<{ itinerary: ItineraryView }>("/api/group/confirm", { itineraryId: it.id });
        const share = myShare(r.itinerary, s.walletAddress!);
        if (share && share.status !== "PENDING") {
          onChange(r.itinerary);
          setBusy(null);
          return;
        }
        await sleep(2000);
      }
      throw new Fail("TIMEOUT_CHAIN");
    } catch (err) {
      fail(err);
    }
  };

  const join = async () => {
    setError(null);
    setBusy(t.groupWorking);
    try {
      const s = await session();
      if (!s) return setBusy(null);
      const r = await api<{ itinerary: ItineraryView }>("/api/group/join", { userToken: s.userToken, itineraryId: it.id, people });
      onChange(r.itinerary);
      setBusy(null);
    } catch (err) {
      fail(err);
    }
  };

  const disable = async () => {
    setError(null);
    setBusy(t.groupEnabling);
    try {
      const s = await session();
      if (!s) return setBusy(null);
      const r = await api<{ itinerary: ItineraryView }>("/api/group/enable", { userToken: s.userToken, itineraryId: it.id, enabled: false });
      onChange(r.itinerary);
      setBusy(null);
    } catch (err) {
      fail(err);
    }
  };

  const shareLink = async () => {
    try {
      if (navigator.share) return await navigator.share({ title: it.title, url: link });
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* dismissed */
    }
  };

  const who = (addr: string) =>
    viewer && addr.toLowerCase() === viewer.toLowerCase()
      ? t.groupYou
      : g.organizerAddress && addr.toLowerCase() === g.organizerAddress.toLowerCase()
        ? `${shortAddr(addr)} · ${t.groupOrganizer}`
        : shortAddr(addr);
  const deadline = `${tripDay(it.startAt, t.dayTomorrow) ? `${tripDay(it.startAt, t.dayTomorrow)} ` : ""}${hhmm(it.startAt)}`;
  const shares = g.shares.filter((s) => s.status !== "PENDING" || s === mine);

  return (
    <section className="space-y-4 rounded-[20px] border border-accent/30 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white">👥 {t.groupTitle}</h2>
          <p className="mt-0.5 text-xs text-ink-2">
            {hasPrepay ? (
              <>
                {t.groupPerPerson}: <b className="text-white">{usdc(per.toFixed(2))}</b>
              </>
            ) : (
              t.groupVenueOnly
            )}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent tabular-nums">
          {(hasPrepay ? t.groupProgress : t.groupJoinProgress).replace("{paid}", String(g.paidPeople)).replace("{total}", String(it.partySize))}
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (g.paidPeople / it.partySize) * 100)}%` }} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-ink-2">{hasPrepay ? t.groupMembers : t.groupMembersJoined}</h3>
        {shares.length ? (
          <ul className="mt-1.5 divide-y divide-line rounded-xl bg-surface-2">
            {shares.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 truncate text-ink">
                  {who(s.payerAddress)} <span className="text-ink-2">· {s.people} {s.people === 1 ? t.person : t.people}</span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${s.status === "PENDING" ? "text-warn" : "text-accent"}`}>
                  {t.groupShareStatus[s.status] ?? s.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-sm text-ink-2">{hasPrepay ? t.groupNobody : t.groupNobodyJoined}</p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {busy}
        </p>
      )}

      {paidMine ? (
        <p className="rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
          ✓ {(mine!.status === "JOINED" ? t.groupJoined : t.groupPaidMine).replace("{n}", String(mine!.people))}
        </p>
      ) : open && paymentsConfigured ? (
        <div className="space-y-3">
          {left > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-2">{hasPrepay ? t.groupPayFor : t.groupJoinFor}</span>
              <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
                <button
                  type="button"
                  onClick={() => setPeople((p) => Math.max(1, p - 1))}
                  disabled={people <= 1 || !!busy}
                  className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-white disabled:opacity-40"
                  aria-label="−"
                >
                  −
                </button>
                <span className="min-w-[72px] text-center text-sm font-semibold text-white tabular-nums">
                  {people} {people === 1 ? t.person : t.people}
                </span>
                <button
                  type="button"
                  onClick={() => setPeople((p) => Math.min(left, p + 1))}
                  disabled={people >= left || !!busy}
                  className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-white disabled:opacity-40"
                  aria-label="+"
                >
                  +
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void (hasPrepay ? pay() : join())}
            disabled={!!busy}
            className="min-h-[48px] w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink disabled:opacity-50"
          >
            {hasPrepay ? t.groupPayMine.replace("{amount}", usdc((per * people).toFixed(2))) : t.groupJoin}
          </button>
          {hasPrepay && <p className="text-center text-xs text-ink-2">{t.groupDeadline.replace("{time}", deadline)}</p>}
        </div>
      ) : (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{left === 0 ? t.groupFull : t.groupClosed}</p>
      )}

      {open && (
        <details className="group rounded-xl bg-surface-2 px-3 open:pb-3" open={organizer && g.paidPeople < it.partySize}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-accent">
            {t.groupInviteTitle}
            <span className="transition-transform group-open:rotate-180" aria-hidden>
              ⌄
            </span>
          </summary>
          <p className="text-xs leading-relaxed text-[#c5d8d1]">{hasPrepay ? t.groupInviteBody : t.groupInviteBodyVenue}</p>
          <div className="mt-3 flex justify-center">{link && <QRVoucher payload={link} label={it.title} hint={t.groupInviteQr} showText={false} />}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard?.writeText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
              className="min-h-11 rounded-xl border border-white/15 text-sm font-semibold text-white"
            >
              {copied ? `✓ ${t.copied}` : t.groupCopyLink}
            </button>
            <button type="button" onClick={() => void shareLink()} className="min-h-11 rounded-xl bg-accent text-sm font-bold text-accent-ink">
              ⤴ {t.share}
            </button>
          </div>
        </details>
      )}

      {g.bills.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-ink-2">{t.billsTitle}</h3>
          {g.bills.map((b) => {
            const stop = it.stops.find((s) => s.id === b.stopId);
            return stop ? <BillPanel key={b.stopId} it={it} stop={stop} onChanged={(next) => next && onChange(next)} /> : null;
          })}
        </div>
      )}

      {hasPrepay && <p className="text-xs leading-relaxed text-ink-2">🔒 {t.groupHow}</p>}
      {hasVenue && <p className="text-xs leading-relaxed text-ink-2">📷 {t.groupHowVenue}</p>}

      {organizer && it.status === "DRAFT" && g.paidPeople === 0 && !busy && (
        <button type="button" onClick={() => void disable()} className="min-h-10 text-xs font-semibold text-ink-2 underline hover:text-white">
          {t.groupDisable}
        </button>
      )}
    </section>
  );
}
