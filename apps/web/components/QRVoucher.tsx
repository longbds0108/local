"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

type Props = {
  payload: string;
  label: string;
  /** Line under the code (defaults to the traveller's "show this to the venue"). */
  hint?: string;
  /** File name for "Save QR image"; omit to hide the button. */
  download?: string;
  /** Show the raw QR text (for pasting when a camera isn't available). */
  showText?: boolean;
};

export default function QRVoucher({ payload, label, hint, download, showText = true }: Props) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(payload, { margin: 2, width: 480, errorCorrectionLevel: "M" })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [payload]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-3">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={t.qrAlt.replace("{name}", label)} width={200} height={200} className="h-[200px] w-[200px]" />
      ) : (
        <div className="h-[200px] w-[200px] animate-pulse rounded bg-neutral-200" />
      )}
      <p className="text-center text-xs text-neutral-600">{hint ?? t.voucherHint}</p>
      {download && src && (
        <a
          href={src}
          download={download}
          className="flex min-h-10 w-full items-center justify-center rounded-lg bg-neutral-100 text-sm font-semibold text-neutral-800"
        >
          ⤓ {t.saveQr}
        </a>
      )}
      {showText && (
        <details className="w-full text-[11px] text-neutral-500">
          <summary className="cursor-pointer">{t.qrText}</summary>
          <code className="block break-all select-all">{payload}</code>
        </details>
      )}
    </div>
  );
}
