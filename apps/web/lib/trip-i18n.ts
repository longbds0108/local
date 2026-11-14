// The AI writes each trip's title and stop notes in both UI languages; show the one
// matching the current language. Older trips have one language only: show what exists.
type Lang = "vi" | "en";

const pick = (locale: Lang, vi: string | null | undefined, en: string | null | undefined, fallback: string | null) =>
  (locale === "en" ? (en ?? vi) : (vi ?? en)) ?? fallback;

export function tripTitle(it: { title: string; titleVi?: string | null; titleEn?: string | null }, locale: Lang): string {
  return pick(locale, it.titleVi, it.titleEn, it.title) ?? it.title;
}

export function stopNote(s: { note: string | null; noteVi?: string | null; noteEn?: string | null }, locale: Lang): string | null {
  return pick(locale, s.noteVi, s.noteEn, s.note);
}
