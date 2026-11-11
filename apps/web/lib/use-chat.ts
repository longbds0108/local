"use client";
// Streaming chat with /api/chat (SSE). Keeps the visible transcript + session id
// in localStorage; the server keeps the full conversation.
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import type { ChatEvent, ItineraryView, MapPlace } from "./types";
import { errorText } from "@/lib/error-text";
import { rememberDraft } from "./drafts";

export type ToolState = { name: string; status: "start" | "done" | "error"; summary?: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; tools: ToolState[]; error?: string };

const SESSION_KEY = "payagent.chat.session";
const TRANSCRIPT_KEY = "payagent.chat.transcript";
const ITINERARY_KEY = "payagent.chat.itinerary";

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function useChat(opts: {
  start: { lat: number; lon: number; isGps: boolean } | null;
  /** Readable area name from the browser geocode (helps the AI when server geocoding is down). */
  area?: string | null;
  onItinerary: (it: ItineraryView | null) => void;
  onPlaces: (places: MapPlace[]) => void;
}) {
  const { t, locale } = useI18n();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Restore the previous chat + itinerary after reload.
  useEffect(() => {
    setSessionId(readJSON<string>(SESSION_KEY));
    setMessages(readJSON<ChatMessage[]>(TRANSCRIPT_KEY) ?? []);
    const itId = readJSON<string>(ITINERARY_KEY);
    if (itId) {
      fetch(`/api/itinerary?id=${encodeURIComponent(itId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.itinerary && optsRef.current.onItinerary(j.itinerary))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!busy) writeJSON(TRANSCRIPT_KEY, messages.slice(-40));
  }, [messages, busy]);

  const patchLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", text: trimmed, tools: [] },
        { id: uid(), role: "assistant", text: "", tools: [] },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const timeout = setTimeout(() => ctrl.abort(), 270_000);
      const start = optsRef.current.start;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionId ?? undefined,
            message: trimmed,
            lat: start?.isGps ? start.lat : undefined,
            lon: start?.isGps ? start.lon : undefined,
            area: start?.isGps ? (optsRef.current.area ?? undefined) : undefined,
            locale,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          const e = (j as { error?: { code?: string; message?: string } }).error;
          patchLast((m) => ({ ...m, error: errorText(t, e?.code ?? "AI_ERROR", e?.message) }));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let ev: ChatEvent;
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            switch (ev.type) {
              case "session":
                setSessionId(ev.sessionId);
                writeJSON(SESSION_KEY, ev.sessionId);
                break;
              case "text":
                patchLast((m) => ({ ...m, text: m.text + ev.delta }));
                break;
              case "tool":
                patchLast((m) => {
                  const tools = [...m.tools];
                  const i = tools.findLastIndex((x) => x.name === ev.name && x.status === "start");
                  if (ev.status !== "start" && i >= 0) tools[i] = { name: ev.name, status: ev.status, summary: ev.summary };
                  else tools.push({ name: ev.name, status: ev.status, summary: ev.summary });
                  return { ...m, tools, text: m.text && !m.text.endsWith("\n\n") ? m.text + "\n\n" : m.text };
                });
                break;
              case "places":
                optsRef.current.onPlaces(ev.places);
                break;
              case "itinerary":
                optsRef.current.onItinerary(ev.itinerary);
                writeJSON(ITINERARY_KEY, ev.itinerary.id);
                rememberDraft(ev.itinerary.id);
                break;
              case "error":
                patchLast((m) => ({ ...m, error: errorText(t, ev.code, ev.message) }));
                break;
            }
          }
        }
      } catch {
        patchLast((m) => ({ ...m, error: ctrl.signal.aborted ? t.err.AI_TIMEOUT : t.err.NETWORK }));
      } finally {
        clearTimeout(timeout);
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, sessionId, locale, t, patchLast],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    optsRef.current.onItinerary(null);
    writeJSON(SESSION_KEY, null);
    writeJSON(TRANSCRIPT_KEY, null);
    writeJSON(ITINERARY_KEY, null);
  }, []);

  return { messages, busy, send, reset };
}
