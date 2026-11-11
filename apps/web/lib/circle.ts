// Circle User-Controlled Wallets REST API (server only — uses CIRCLE_API_KEY).
// Endpoints per developers.circle.com (checked 2026-11-10):
//   POST /v1/w3s/users/social/token                   create device token (social login)
//   POST /v1/w3s/user/initialize                      create wallet → challengeId   (X-User-Token)
//   GET  /v1/w3s/wallets                              list the user's wallets       (X-User-Token)
//   POST /v1/w3s/user/transactions/contractExecution  contract call → challengeId   (X-User-Token)
// The user's keys never touch this server: every signature happens in Circle's
// SDK UI after the user confirms the challenge.
import { randomUUID } from "node:crypto";
import { config, required } from "./env";

export class CircleError extends Error {
  constructor(
    public status: number,
    public code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "CircleError";
  }
}

/** Circle error codes we handle explicitly. */
export const CIRCLE_CODES = {
  userAlreadyExists: 155101,
  userAlreadyInitialized: 155106,
  userTokenExpired: 155104,
  userTokenInvalid: 155105,
  userTokenNotFound: 155103,
} as const;

async function circleFetch<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; userToken?: string }): Promise<T> {
  const [apiKey] = required("CIRCLE_API_KEY");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (init.userToken) headers["X-User-Token"] = init.userToken;

  const res = await fetch(`${config.circleBaseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const text = await res.text();
  let json: { data?: T; code?: number; message?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    throw new CircleError(res.status, json.code, json.message ?? `Circle API HTTP ${res.status}`);
  }
  return (json.data ?? {}) as T;
}

export async function createDeviceToken(deviceId: string) {
  return circleFetch<{ deviceToken: string; deviceEncryptionKey: string }>("/v1/w3s/users/social/token", {
    method: "POST",
    body: { idempotencyKey: randomUUID(), deviceId },
  });
}

// ---- PIN users (no social login) -------------------------------------------
// POST /v1/w3s/users        create a user identified by our own userId
// POST /v1/w3s/users/token  short-lived userToken + encryptionKey for that user
// The user sets a PIN + security questions in Circle's UI on the first
// challenge and confirms every later transaction with that PIN.

export async function createPinUser(userId: string): Promise<void> {
  try {
    await circleFetch("/v1/w3s/users", { method: "POST", body: { userId } });
  } catch (err) {
    if (!(err instanceof CircleError && err.code === CIRCLE_CODES.userAlreadyExists)) throw err;
  }
}

export async function createUserToken(userId: string) {
  return circleFetch<{ userToken: string; encryptionKey: string }>("/v1/w3s/users/token", {
    method: "POST",
    body: { userId },
  });
}

export async function initializeUser(userToken: string) {
  return circleFetch<{ challengeId: string }>("/v1/w3s/user/initialize", {
    method: "POST",
    userToken,
    body: {
      idempotencyKey: randomUUID(),
      accountType: config.circleAccountType,
      blockchains: [config.circleBlockchain],
    },
  });
}

export type CircleWallet = {
  id: string;
  address: string;
  blockchain: string;
  state?: string;
  userId?: string;
  accountType?: string;
};

export async function listWallets(userToken: string): Promise<CircleWallet[]> {
  const data = await circleFetch<{ wallets?: CircleWallet[] }>(
    `/v1/w3s/wallets?blockchain=${encodeURIComponent(config.circleBlockchain)}&pageSize=50`,
    { method: "GET", userToken },
  );
  return data.wallets ?? [];
}

/** The user's wallet on the configured chain, or null if not created yet. */
export async function getArcWallet(userToken: string): Promise<CircleWallet | null> {
  const wallets = await listWallets(userToken);
  return wallets.find((w) => w.blockchain === config.circleBlockchain && (w.state ?? "LIVE") === "LIVE") ?? null;
}

export async function createContractExecutionChallenge(args: {
  userToken: string;
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: (string | string[])[];
  /** Native token sent with the call, as a decimal string in whole USDC (payable functions only). */
  amount?: string;
  refId?: string;
}) {
  return circleFetch<{ challengeId: string }>("/v1/w3s/user/transactions/contractExecution", {
    method: "POST",
    userToken: args.userToken,
    body: {
      idempotencyKey: randomUUID(),
      walletId: args.walletId,
      contractAddress: args.contractAddress,
      abiFunctionSignature: args.abiFunctionSignature,
      abiParameters: args.abiParameters,
      ...(args.amount ? { amount: args.amount } : {}),
      feeLevel: "MEDIUM",
      refId: args.refId,
    },
  });
}
