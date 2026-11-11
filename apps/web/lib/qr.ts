import { randomBytes } from "node:crypto";

/**
 * Legacy per-stop secret (v1 HMAC vouchers). Escrow v2 replaced it with check-in
 * codes created on the traveller's device (lib/checkin-codes.ts); the column is
 * still required by the schema, so new stops get a random value.
 */
export function newQrSecret(): string {
  return randomBytes(32).toString("hex");
}
