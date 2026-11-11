"use client";
// Unpaid itineraries planned in this browser. Drafts belong to no wallet yet
// (paying is what attaches a trip to a wallet), so they live here — like the
// PIN wallet itself, they are tied to this browser. Ids are unguessable cuids.

const LIST_KEY = "hedgora.drafts";
const CHAT_KEY = "hedgora.chat.itinerary"; // the draft the current chat is editing
const MAX = 10;
export const DRAFTS_EVENT = "hedgora-drafts";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(ids: string[], notify: boolean) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(ids.slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
  if (notify) window.dispatchEvent(new Event(DRAFTS_EVENT));
}

/** Newest first; includes the chat's current draft. */
export function draftIds(): string[] {
  const list = read<string[]>(LIST_KEY) ?? [];
  const chat = read<string>(CHAT_KEY);
  const all = chat ? [chat, ...list] : list;
  return [...new Set(all.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, MAX);
}

export function rememberDraft(id: string) {
  write([id, ...draftIds().filter((x) => x !== id)], true);
}

/** Drop ids that are paid (now shown under the wallet) or gone. Silent: the caller already has fresh data. */
export function forgetDrafts(ids: string[]) {
  if (!ids.length) return;
  const drop = new Set(ids);
  write((read<string[]>(LIST_KEY) ?? []).filter((x) => !drop.has(x)), false);
}
