"use client";

import Link from "next/link";
import { useState } from "react";
import { hhmm, shortAddr, usdc } from "@/lib/format";
import { merchantName } from "@/lib/i18n";
import type { DashboardActivity } from "@/lib/types";
import { useAccount } from "@/lib/use-account";
import { useI18n } from "../I18nProvider";
import { tripHref } from "./TripsClient";
import { AccountPage, ConnectCard, dayMonth, ErrorNote, fill } from "./shared";

function ActivityRow({ a }: { a: DashboardActivity }) {
  const { t, locale } = useI18n();
  const when = `${dayMonth(a.at, locale)} ${hhmm(a.at)}`;
  const meta = {
    deposit: { icon: "↑", title: fill(t.dashTxPay, { trip: a.title }), note: t.dashTxPayNote, amount: `−${usdc(a.amountUsdc)}`, amountCls: "text-white", iconCls: "bg-surface-2 text-ink" },
    release: {
      icon: "✓",
      title: fill(t.dashTxRelease, { merchant: a.merchant ? merchantName(t, { id: a.merchantId, name: a.merchant }) : a.title }),
      note: t.dashTxReleaseNote,
      amount: usdc(a.amountUsdc),
      amountCls: "text-ink-2",
      iconCls: "bg-accent-soft text-accent",
    },
    venue: {
      icon: "↗",
      title: fill(t.dashTxVenue, { merchant: a.merchant ? merchantName(t, { id: a.merchantId, name: a.merchant }) : a.title }),
      note: t.dashTxVenueNote,
      amount: `−${usdc(a.amountUsdc)}`,
      amountCls: "text-white",
      iconCls: "bg-surface-2 text-ink",
    },
    refund: { icon: "↩", title: fill(t.dashTxRefund, { place: a.title }), note: t.dashTxRefundNote, amount: `+${usdc(a.amountUsdc)}`, amountCls: "text-accent", iconCls: "bg-accent-soft text-accent" },
  }[a.type];
  // Each row opens its trip; the blockchain record is on the trip page.
  return (
    <Link href={tripHref(a.itineraryId)} className="flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.04]">
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
    </Link>
  );
}

/** /wallet — balance, where the trip money is, and payment history. */
export default function WalletClient() {
  const { t } = useI18n();
  const { session, checked, data, loading, error, connecting, connect, balance, address } = useAccount("/wallet");
  const [copied, setCopied] = useState(false);

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
    <AccountPage title={t.walletTitle} subtitle={t.walletSubtitle}>
      <ErrorNote text={error} />
      {checked && !session && <ConnectCard onConnect={() => void connect()} connecting={connecting} />}
      {session && data && !data.wallet && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{t.dashNoWallet}</p>}

      {session && (
        <div className="fx-stagger space-y-6">
          {/* 1. Balance */}
          <section className="fx-pan rounded-[24px] bg-gradient-to-br from-[#0f3a32] via-[#0b2a24] to-[#081d19] p-5 md:p-6">
            <div className="text-xs text-[#b8cdc6]">
              {t.usdcBalance} · {t.arcTestnet}
            </div>
            <div className="mt-1 font-display text-[40px] leading-none font-extrabold text-white">
              <span key={balance ?? "none"} className="fx-pop">
                {balance ?? (loading ? "…" : "—")}
              </span>
              <span className="ml-2 text-base font-bold text-ink-2">USDC</span>
            </div>
            {address && (
              <button
                type="button"
                onClick={copyAddr}
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white/[0.06] px-3 text-xs text-[#dffff4] tabular-nums"
                title={t.copy}
              >
                {shortAddr(address)} {copied ? "✓" : "⧉"}
              </button>
            )}
            <div className="mt-4 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              <a
                href={data?.faucetUrl ?? "https://faucet.circle.com"}
                target="_blank"
                rel="noreferrer"
                className="fx-shine flex min-h-11 items-center justify-center rounded-xl bg-accent px-3 text-sm font-bold text-accent-ink"
              >
                {t.dashTopUp} ↗
              </a>
              {address && data?.explorerUrl ? (
                <a
                  href={`${data.explorerUrl}/address/${address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-3 text-sm font-bold text-white"
                >
                  {t.explorerShort} ↗
                </a>
              ) : (
                <span />
              )}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-ink-2">{t.walletBrowserNote}</p>
          </section>

          {/* 2. Where the trip money is */}
          <section className="rounded-[20px] border border-line bg-surface p-5">
            <h2 className="font-display text-base font-bold text-white">{t.dashMoneyTitle}</h2>
            {moneyTotal > 0 ? (
              <>
                <div className="fx-grow mt-3 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
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

          {/* 3. History */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-ink-2">{t.dashHistoryTitle}</h2>
            {data?.activity.length ? (
              <div className="fx-stagger divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
                {data.activity.map((a, i) => (
                  <ActivityRow key={`${a.type}-${a.txHash ?? i}-${a.at}`} a={a} />
                ))}
              </div>
            ) : (
              <p className="rounded-[20px] border border-dashed border-[#2b4a43] p-5 text-sm text-ink-2">{loading ? t.loading : t.dashNoActivity}</p>
            )}
          </section>
        </div>
      )}
    </AccountPage>
  );
}
