"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { hhmm, usdc } from "@/lib/format";
import type { ItineraryView } from "@/lib/types";
import { BackLink, DateBlock } from "../account/shared";
import { useI18n } from "../I18nProvider";
import PaymentPanel from "./PaymentPanel";
import VoucherPanel from "./VoucherPanel";

type Props = {
  initial: ItineraryView;
  vouchers: Record<string, string>;
  explorerUrl: string | null;
  faucetUrl: string | null;
  feeEstimate: string | null;
  paymentsConfigured: boolean;
};

/** Plan → Pay → Go & scan → Done. Index of the step the trip is on. */
function currentStep(it: ItineraryView): number {
  if (it.status === "DRAFT") return 1;
  if (it.status === "PAID") return 2;
  return 4; // finished: every step done
}

function Stepper({ step }: { step: number }) {
  const { t } = useI18n();
  const labels = [t.stepPlan, t.stepPay, t.stepGo, t.stepDone];
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

/** /trips/[id] — one page per trip; what it shows follows the trip's state. */
export default function TripDetail({ initial, vouchers, explorerUrl, faucetUrl, feeEstimate, paymentsConfigured }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [it, setIt] = useState(initial);
  // A server refresh (after paying) brings a new itinerary + signed QR codes.
  useEffect(() => setIt(initial), [initial]);
  const onPaid = useCallback(() => router.refresh(), [router]);

  const step = currentStep(it);
  const pill =
    it.status === "DRAFT"
      ? { text: t.dashUnpaid, cls: "bg-warn-soft text-warn" }
      : { text: t.status[it.status] ?? it.status, cls: it.status === "PAID" ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2" };

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-[18px] pt-4 pb-10">
      <BackLink href="/trips" label={t.dashTitle} />

      <header className="flex items-start gap-3">
        <DateBlock iso={it.startAt} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[22px] leading-snug font-extrabold text-white">{it.title}</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {hhmm(it.startAt)}–{hhmm(it.endAt)} · {it.partySize} {it.partySize === 1 ? t.person : t.people} · {usdc(it.totalUsdc)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pill.cls}`}>{pill.text}</span>
            <span className="rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-semibold text-warn">{t.testnetShort}</span>
          </div>
        </div>
      </header>

      <Stepper step={step} />

      {it.status === "DRAFT" ? (
        <PaymentPanel initial={it} faucetUrl={faucetUrl} feeEstimate={feeEstimate} paymentsConfigured={paymentsConfigured} onPaid={onPaid} />
      ) : (
        <VoucherPanel it={it} onChange={setIt} vouchers={vouchers} explorerUrl={explorerUrl} />
      )}
    </div>
  );
}
