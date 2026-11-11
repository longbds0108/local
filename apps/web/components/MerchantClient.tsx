"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { shortAddr, usdc } from "@/lib/format";
import { useI18n } from "./I18nProvider";
import Scanner from "./Scanner";

type Merchant = { id: string; name: string; walletAddress: string };
type Detail = {
  merchant: Merchant;
  balance: string | null;
  revenueUsdc: string;
  explorerUrl: string | null;
  released: { id: string; name: string; priceUsdc: string; releaseTx: string | null; checkedInAt: string | null }[];
};
type Result = { ok: true; name: string; amount: string; txHash: string; url: string | null } | { ok: false; message: string };

const MERCHANT_KEY = "hedgora.merchant";

/** hedgora://checkin?s={stopId}&sig={hex} → { stopId, sig } */
function parsePayload(text: string): { stopId: string; sig: string } | null {
  const m = text.trim().match(/^hedgora:\/\/checkin\?(.+)$/);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const stopId = q.get("s");
  const sig = q.get("sig");
  return stopId && sig && /^[0-9a-f]{64}$/i.test(sig) ? { stopId, sig } : null;
}

export default function MerchantClient() {
  const { t } = useI18n();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string>("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [paste, setPaste] = useState("");
  const lastScan = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    fetch("/api/merchant")
      .then((r) => r.json())
      .then((j: { merchants: Merchant[] }) => {
        setMerchants(j.merchants ?? []);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(MERCHANT_KEY);
        } catch {
          /* ignore */
        }
        const pick = j.merchants?.find((m) => m.id === saved)?.id ?? j.merchants?.[0]?.id ?? "";
        setMerchantId(pick);
      })
      .catch(() => setMerchants([]));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    const res = await fetch(`/api/merchant?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, []);

  useEffect(() => {
    void loadDetail(merchantId);
    try {
      if (merchantId) localStorage.setItem(MERCHANT_KEY, merchantId);
    } catch {
      /* ignore */
    }
  }, [merchantId, loadDetail]);

  const checkin = useCallback(
    async (text: string) => {
      // html5-qrcode fires repeatedly for the same code; ignore duplicates for 5s.
      const now = Date.now();
      if (processing || (lastScan.current && lastScan.current.text === text && now - lastScan.current.at < 5000)) return;
      lastScan.current = { text, at: now };

      const parsed = parsePayload(text);
      if (!parsed) {
        setResult({ ok: false, message: t.scanInvalid });
        return;
      }
      setProcessing(true);
      setResult(null);
      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...parsed, merchantId }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResult({ ok: false, message: (j as { error?: { message?: string } }).error?.message ?? t.err.TX_FAILED });
          return;
        }
        const ok = j as { stop: { name: string; amountUsdc: string }; txHash: string; explorerTxUrl: string | null };
        setResult({ ok: true, name: ok.stop.name, amount: ok.stop.amountUsdc, txHash: ok.txHash, url: ok.explorerTxUrl });
        setPaste("");
        void loadDetail(merchantId);
      } catch {
        setResult({ ok: false, message: t.err.NETWORK });
      } finally {
        setProcessing(false);
      }
    },
    [merchantId, processing, loadDetail, t],
  );

  const onPaste = (e: FormEvent) => {
    e.preventDefault();
    lastScan.current = null;
    void checkin(paste);
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-5">
      <h1 className="text-xl font-bold text-ink">🏪 {t.merchantTitle}</h1>
      <p className="text-xs text-warn">⚠️ {t.testnetBadge}</p>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-ink">{t.merchantSelect}</span>
        <select
          value={merchantId}
          onChange={(e) => {
            setMerchantId(e.target.value);
            setResult(null);
          }}
          className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink"
        >
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      {detail && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line bg-surface p-3">
            <div className="text-xs text-ink-2">{t.merchantRevenue}</div>
            <div className="text-lg font-bold text-ink">{usdc(detail.revenueUsdc)}</div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-3">
            <div className="text-xs text-ink-2">{t.merchantBalance}</div>
            <div className="text-lg font-bold text-ink">{detail.balance !== null ? usdc(Number(detail.balance).toFixed(2)) : "—"}</div>
            {detail.explorerUrl ? (
              <a
                href={`${detail.explorerUrl}/address/${detail.merchant.walletAddress}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block min-h-6 pt-1 font-mono text-[11px] text-accent underline"
              >
                {shortAddr(detail.merchant.walletAddress)} ↗
              </a>
            ) : (
              <span className="font-mono text-[11px] text-ink-2">{shortAddr(detail.merchant.walletAddress)}</span>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <Scanner onScan={(text) => void checkin(text)} disabled={!merchantId} />
        <form onSubmit={onPaste} className="space-y-2">
          <label htmlFor="qr-paste" className="text-xs text-ink-2">
            {t.scanPaste}
          </label>
          <div className="flex gap-2">
            <input
              id="qr-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="hedgora://checkin?s=…&sig=…"
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 font-mono text-base text-ink"
            />
            <button
              type="submit"
              disabled={processing || !paste.trim() || !merchantId}
              className="min-h-[44px] rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {t.scanSubmit}
            </button>
          </div>
        </form>

        {processing && (
          <p role="status" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
            {t.scanProcessing}
          </p>
        )}
        {result &&
          (result.ok ? (
            <div role="status" className="space-y-1 rounded-xl bg-ok-soft p-3 text-sm text-ok">
              <div className="font-bold">
                ✅ {t.scanSuccess} {usdc(result.amount)} — {result.name}
              </div>
              {result.url ? (
                <a href={result.url} target="_blank" rel="noreferrer" className="text-xs break-all underline">
                  {result.txHash} ↗
                </a>
              ) : (
                <code className="text-xs break-all">{result.txHash}</code>
              )}
            </div>
          ) : (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              {result.message}
            </p>
          ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">{t.releasedList}</h2>
        {!detail || detail.released.length === 0 ? (
          <p className="text-sm text-ink-2">{t.none}</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {detail.released.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate text-ink">{r.name}</span>
                {r.releaseTx && detail.explorerUrl ? (
                  <a href={`${detail.explorerUrl}/tx/${r.releaseTx}`} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-accent">
                    {usdc(r.priceUsdc)} ↗
                  </a>
                ) : (
                  <span className="shrink-0 font-semibold text-ink">{usdc(r.priceUsdc)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
