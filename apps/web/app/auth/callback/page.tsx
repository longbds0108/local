"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { completeGoogleLogin, ensureWallet } from "@/lib/circle-client";

/** Google redirects here (register this exact URL as an authorized redirect URI). */
export default function AuthCallbackPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [msg, setMsg] = useState<string>(t.loggingIn);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const { session, returnTo } = await completeGoogleLogin();
        setMsg(t.creatingWallet);
        await ensureWallet(session, () => setMsg(t.creatingWallet));
        // Only same-origin relative paths.
        router.replace(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
      } catch (err) {
        setError((err as Error).message || "Login failed");
      }
    })();
  }, [router, t]);

  return (
    <div className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
      {error ? (
        <>
          <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
          <Link href="/" className="text-sm text-accent underline">
            {t.backToMap}
          </Link>
        </>
      ) : (
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-ink-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          {msg}
        </p>
      )}
    </div>
  );
}
