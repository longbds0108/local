"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

export default function QRVoucher({ payload, label }: { payload: string; label: string }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(payload, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [payload]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-3">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`QR voucher — ${label}`} width={200} height={200} className="h-[200px] w-[200px]" />
      ) : (
        <div className="h-[200px] w-[200px] animate-pulse rounded bg-neutral-200" />
      )}
      <p className="text-center text-xs text-neutral-600">{t.voucherHint}</p>
      <details className="w-full text-[11px] text-neutral-500">
        <summary className="cursor-pointer">QR text</summary>
        <code className="block break-all select-all">{payload}</code>
      </details>
    </div>
  );
}
