"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  CircleClientError,
  circleConfigured,
  connectWallet,
  getOrRefreshSession,
  getSession,
  logout,
  SESSION_EVENT,
  type CircleSession,
} from "./circle-client";
import { errorText } from "./error-text";
import type { DashboardData } from "./types";

const DRAFT_KEY = "hedgora.chat.itinerary";

/** Session + the traveller's trips/wallet data, shared by /trips and /wallet. */
export function useAccount(returnTo: string) {
  const { t } = useI18n();
  const [session, setSession] = useState<CircleSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(
    async (s: CircleSession) => {
      setLoading(true);
      setError(null);
      try {
        let draftIds: string[] = [];
        try {
          const id = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as string | null;
          if (id) draftIds = [id];
        } catch {
          /* ignore */
        }
        const res = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userToken: s.userToken, draftIds }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const e = (j as { error?: { code?: string; message?: string } }).error;
          if (e?.code === "UNAUTHORIZED") {
            const fresh = await getOrRefreshSession().catch(() => null);
            if (fresh && fresh.userToken !== s.userToken) return load(fresh);
            logout();
            setSession(null);
          }
          setError(errorText(t, e?.code, e?.message));
          return;
        }
        setData(j as DashboardData);
      } catch {
        setError(t.err.NETWORK);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void (async () => {
      const s = await getOrRefreshSession().catch(() => null);
      setSession(s);
      setChecked(true);
      if (s) void load(s);
    })();
    const onChange = () => {
      const s = getSession();
      setSession(s);
      if (s) void load(s);
      else setData(null);
    };
    window.addEventListener(SESSION_EVENT, onChange);
    return () => window.removeEventListener(SESSION_EVENT, onChange);
  }, [load]);

  const connect = async () => {
    setError(null);
    if (!circleConfigured()) {
      setError(t.walletNotConfigured);
      return;
    }
    setConnecting(true);
    try {
      const s = await connectWallet(returnTo);
      if (s) {
        setSession(s);
        void load(s);
      }
    } catch (err) {
      setError(errorText(t, err instanceof CircleClientError ? err.code : null, (err as Error).message));
    } finally {
      setConnecting(false);
    }
  };

  const balance =
    data?.balanceUsdc !== undefined && data?.balanceUsdc !== null ? Number(data.balanceUsdc).toFixed(2) : null;
  const address = data?.wallet?.address ?? session?.walletAddress ?? null;

  return { session, checked, data, loading, error, connecting, connect, balance, address };
}
