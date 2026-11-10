"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";

type Html5QrcodeT = import("html5-qrcode").Html5Qrcode;

/** Camera QR scanner (html5-qrcode). Calls onScan with each decoded text. */
export default function Scanner({ onScan, disabled }: { onScan: (text: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const id = "qr-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const scannerRef = useRef<Html5QrcodeT | null>(null);
  const onScanRef = useRef(onScan);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  onScanRef.current = onScan;

  const stop = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    setRunning(false);
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* already stopped */
      }
    }
  };

  const start = async () => {
    setError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const s = new Html5Qrcode(id);
      scannerRef.current = s;
      await s.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (text) => onScanRef.current(text),
        () => {
          /* no QR in frame */
        },
      );
      setRunning(true);
    } catch {
      setError(t.cameraError);
      await stop();
    }
  };

  useEffect(() => {
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div id={id} className={`overflow-hidden rounded-xl bg-black ${running ? "min-h-[260px]" : "h-0"}`} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => (running ? void stop() : void start())}
        className="min-h-[44px] w-full rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
      >
        📷 {running ? t.scanStop : t.scanStart}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
