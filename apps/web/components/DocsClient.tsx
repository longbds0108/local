"use client";

import Link from "next/link";
import { useI18n } from "./I18nProvider";
import { docs, type DocLink } from "@/lib/docs";

function DocButton({ link, primary }: { link: DocLink; primary: boolean }) {
  const cls = `inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-bold ${
    primary ? "bg-accent text-accent-ink hover:brightness-110" : "border border-[#25423d] bg-[#0b211e] text-white hover:border-accent/50"
  }`;
  return link.external ? (
    <a href={link.href} target="_blank" rel="noreferrer" className={cls}>
      {link.label} <span aria-hidden>↗</span>
    </a>
  ) : (
    <Link href={link.href} className={cls}>
      {link.label} <span aria-hidden>→</span>
    </Link>
  );
}

export default function DocsClient() {
  const { locale } = useI18n();
  const d = docs[locale];

  return (
    <div className="mx-auto max-w-[1440px] px-[18px] pt-8 pb-16 md:px-[7vw] md:pt-16 md:pb-24">
      <header className="max-w-[760px]">
        <div className="text-[11px] font-extrabold tracking-[2px] text-accent">✦ {d.eyebrow}</div>
        <h1 className="mt-3 font-display text-[32px] leading-tight font-extrabold text-white md:text-[52px]">{d.title}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#a7bbb5] md:text-lg">{d.lead}</p>
      </header>

      <div className="mt-10 grid gap-10 md:mt-14 md:grid-cols-[220px_1fr] md:gap-[5vw]">
        <nav aria-label={d.tocLabel} className="hidden md:block">
          <div className="sticky top-24">
            <h2 className="text-[11px] font-extrabold tracking-[2px] text-ink-2 uppercase">{d.tocLabel}</h2>
            <ol className="mt-3 border-l border-line">
              {d.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px flex min-h-10 items-center border-l border-transparent pl-4 text-sm text-[#a7bbb5] hover:border-accent hover:text-white">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="min-w-0 max-w-[820px] space-y-5">
          {d.sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="scroll-mt-24 rounded-[22px] border border-[#1c3833] bg-[#0b201d] p-5 md:p-8"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-extrabold text-accent" aria-hidden>
                  {i + 1}
                </span>
                <h2 id={`${s.id}-title`} className="font-display text-xl font-extrabold text-white md:text-2xl">
                  {s.title}
                </h2>
              </div>

              {s.intro && <p className="mt-4 text-[15px] leading-relaxed text-[#cfe0da]">{s.intro}</p>}

              {s.steps && (
                <ol className="mt-4 space-y-3">
                  {s.steps.map((step, j) => (
                    <li key={j} className="flex gap-3 text-[15px] leading-relaxed text-[#cfe0da]">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[#2c4b45] text-xs font-bold text-ink-2" aria-hidden>
                        {j + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}

              {s.cards && (
                <div className="mt-5 grid gap-3 lg:grid-cols-3">
                  {s.cards.map((c) => (
                    <div key={c.title} className="rounded-2xl border border-[#25423d] bg-[#0e2824] p-4">
                      <h3 className="font-display text-base font-extrabold text-white">{c.title}</h3>
                      <p className="mt-2 text-xs leading-relaxed text-accent">
                        <span className="sr-only">{d.whenLabel}: </span>
                        {c.when}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#a7bbb5]">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {s.bullets && (
                <ul className="mt-4 space-y-2.5">
                  {s.bullets.map((b, j) => (
                    <li key={j} className="flex gap-3 text-[15px] leading-relaxed text-[#cfe0da]">
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}

              {s.links && (
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {s.links.map((l, j) => (
                    <DocButton key={l.href} link={l} primary={j === s.links!.length - 1} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
