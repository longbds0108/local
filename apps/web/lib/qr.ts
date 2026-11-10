import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function newQrSecret(): string {
  return randomBytes(32).toString("hex");
}

/** sig = HMAC_SHA256(stopId, key = qrSecret), hex. */
export function signStop(stopId: string, qrSecret: string): string {
  return createHmac("sha256", Buffer.from(qrSecret, "hex")).update(stopId).digest("hex");
}

export function verifyStopSig(stopId: string, qrSecret: string, sig: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = Buffer.from(signStop(stopId, qrSecret), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function qrPayload(stopId: string, qrSecret: string): string {
  return `hedgora://checkin?s=${encodeURIComponent(stopId)}&sig=${signStop(stopId, qrSecret)}`;
}
