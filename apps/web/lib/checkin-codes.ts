"use client";
// Check-in codes: one random 32-byte secret per paid stop, created in the
// traveller's browser at payment time. Only keccak256(code) leaves the device
// (stored in the escrow); showing the QR at the venue hands the code over, and
// the escrow releases that stop only with it. Lose the browser data → the stop
// can't be checked in, but its money is still refundable to the payer.
import { bytesToHex, keccak256, type Hex } from "viem";

const key = (itineraryId: string) => `payagent.codes.${itineraryId}`;

export function codesFor(itineraryId: string): Record<string, Hex> {
  try {
    return (JSON.parse(localStorage.getItem(key(itineraryId)) ?? "{}") as Record<string, Hex>) ?? {};
  } catch {
    return {};
  }
}

/** Keeps existing codes (a retried payment must reuse them) and adds any missing. */
export function ensureCodes(itineraryId: string, stopIds: string[]): Record<string, Hex> {
  const codes = codesFor(itineraryId);
  for (const id of stopIds) {
    if (!codes[id]) codes[id] = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  }
  localStorage.setItem(key(itineraryId), JSON.stringify(codes));
  // Read back: if storage failed, paying would lock money nobody could release.
  const saved = codesFor(itineraryId);
  if (stopIds.some((id) => saved[id] !== codes[id])) throw new Error("STORAGE");
  return codes;
}

export function codeHashes(codes: Record<string, Hex>): Record<string, Hex> {
  return Object.fromEntries(Object.entries(codes).map(([id, c]) => [id, keccak256(c)]));
}

/** What the venue scans: stop id + code. */
export function checkinPayload(stopId: string, code: Hex): string {
  return `payagent://checkin?s=${encodeURIComponent(stopId)}&c=${code.slice(2)}`;
}
