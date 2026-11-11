"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/lib/use-chat";
import { useI18n } from "../I18nProvider";

type Props = {
  messages: ChatMessage[];
  busy: boolean;
  hasItinerary: boolean;
  onSend: (text: string) => void;
  onReset: () => void;
};

/** Server sends the bare number ("14"); older saved chats may hold "14 places". */
function toolSummary(template: string | undefined, raw: string | undefined): string {
  const n = raw?.match(/^[\d.]+/)?.[0];
  return n && template ? ` · ${template.replace("{n}", n)}` : "";
}

export default function AskCard({ messages, busy, hasItinerary, onSend, onReset }: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    onSend(input);
    setInput("");
  };

  return (
    <div id="ask" className="fx-rise grid scroll-mt-24 grid-cols-[auto_1fr] gap-x-3.5 gap-y-2.5 rounded-[22px] bg-deep p-[18px] text-white md:p-6">
      <div className="fx-float row-span-2 grid h-[42px] w-[42px] place-items-center rounded-[13px] bg-gradient-to-br from-[#86ffd2] to-[#1ab884] text-[#073526]">
        ✦
      </div>
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-2">
        <div className="flex flex-col">
          <b>{t.askTitle}</b>
          <span className="text-xs text-[#9bb0aa]">{t.askSubtitle}</span>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={onReset} className="-my-2 min-h-10 shrink-0 px-1 text-xs text-accent hover:underline">
            {t.chatNew}
          </button>
        )}
      </div>

      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="col-span-full max-h-[50dvh] space-y-3 md:max-h-[380px] overflow-y-auto rounded-xl bg-[#13342d] p-3.5 text-sm leading-relaxed text-[#d9eee7]"
          aria-live="polite"
        >
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 whitespace-pre-wrap text-accent-ink">{m.text}</p>
              </div>
            ) : (
              <div key={m.id} className="space-y-2">
                <b className="text-accent">Toura ✦</b>
                {m.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.tools.map((tool, k) => (
                      <span
                        key={k}
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          tool.status === "error" ? "bg-[#ff8a7f]/15 text-[#ffb3ab]" : "bg-white/5 text-[#c5d8d1]"
                        }`}
                      >
                        {tool.status === "start" ? "⏳" : tool.status === "done" ? "✓" : "↻"} {t.tool[tool.name] ?? tool.name}
                        {toolSummary(t.toolSummary[tool.name], tool.summary)}
                      </span>
                    ))}
                  </div>
                )}
                {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
                {!m.text && !m.error && busy && i === messages.length - 1 && (
                  <p className="animate-pulse text-[#9bb0aa]">{t.chatThinking}</p>
                )}
                {m.error && (
                  <p role="alert" className="rounded-lg bg-[#ff8a7f]/15 px-3 py-2 text-[#ffb3ab]">
                    {m.error}
                  </p>
                )}
              </div>
            ),
          )}
          {hasItinerary && !busy && (
            <>
              <a href="#itinerary" className="inline-flex min-h-10 items-center rounded-lg bg-accent/15 px-3 text-sm font-semibold text-accent">
                {t.askItineraryReady} ↓
              </a>
              {/* One-tap edits instead of typing. */}
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {t.quickEdits.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => onSend(q.prompt)}
                    className="min-h-10 shrink-0 rounded-full border border-white/15 px-3 text-sm whitespace-nowrap text-[#dffff4] hover:border-accent"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <form onSubmit={submit} className="col-span-full mt-2 block rounded-[13px] sm:flex sm:bg-white sm:p-[5px]">
        <label htmlFor="ask-input" className="sr-only">
          {t.askTitle}
        </label>
        <input
          id="ask-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder={t.askPlaceholder}
          className="mb-2 h-12 w-full min-w-0 rounded-[10px] bg-white px-3 text-base text-[#10211e] outline-none placeholder:text-[#84918d] sm:mb-0 sm:h-auto sm:flex-1 sm:rounded-none sm:bg-transparent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="min-h-12 w-full rounded-[9px] bg-accent px-[18px] text-base font-bold sm:min-h-[44px] sm:text-sm text-[#08231c] disabled:opacity-60 sm:w-auto"
        >
          {busy ? t.chatThinkingShort : `${t.askButton} →`}
        </button>
      </form>

      <div className="col-span-full -mx-[18px] flex gap-2 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {t.quickPrompts.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => onSend(p.prompt)}
            className="min-h-10 shrink-0 rounded-[20px] border border-white/10 bg-white/[0.04] px-3.5 text-sm whitespace-nowrap text-[#c5d8d1] hover:border-accent/50 disabled:opacity-50 sm:text-xs"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
