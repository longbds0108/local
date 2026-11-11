import type { Dict } from "./i18n";

/**
 * The message to show for a failed request, always in the UI language.
 * Server messages are English; they are only shown through the dictionary,
 * never raw, so a Vietnamese screen never shows an English sentence.
 */
export function errorText(t: Dict, code?: string | null, message?: string | null): string {
  if (message && t.errMsg[message]) return t.errMsg[message];
  if (code && t.err[code]) return t.err[code];
  return t.err.GENERIC;
}
