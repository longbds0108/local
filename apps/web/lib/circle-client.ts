"use client";
// Browser side of Circle User-Controlled Wallets (Web SDK @circle-fin/w3s-pw-web-sdk).
// The SDK renders Circle's own confirmation UI in an iframe; the user approves
// every transaction there. Our server never sees keys or PINs.
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

const APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

const DEVICE_KEY = "hedgora.circle.device";
const SESSION_KEY = "hedgora.circle.session";
const RETURN_KEY = "hedgora.circle.returnTo";

export type CircleSession = {
  userToken: string;
  encryptionKey: string;
  email?: string;
  walletId?: string;
  walletAddress?: string;
  savedAt: number;
};

export class CircleClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function circleConfigured() {
  return !!APP_ID && !!GOOGLE_CLIENT_ID;
}

function redirectUri() {
  return `${window.location.origin}/auth/callback`;
}

function store<T>(key: string, value: T | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// User tokens are short-lived; treat sessions older than 50 minutes as expired.
const SESSION_TTL_MS = 50 * 60_000;

export function getSession(): CircleSession | null {
  const s = load<CircleSession>(SESSION_KEY);
  if (!s || Date.now() - s.savedAt > SESSION_TTL_MS) return null;
  return s;
}

export function saveSession(s: CircleSession | null) {
  store(SESSION_KEY, s);
}

async function getSdk(): Promise<W3SSdk> {
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  // The SDK is a singleton; constructing again just updates its config.
  return new W3SSdk({ appSettings: { appId: APP_ID } });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } }).error;
    throw new CircleClientError(e?.code ?? "HTTP_" + res.status, e?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

/** Step 1: get a device token from our server, then redirect to Google. */
export async function startGoogleLogin(returnTo: string) {
  if (!circleConfigured()) throw new CircleClientError("NOT_CONFIGURED", "NEXT_PUBLIC_CIRCLE_APP_ID / NEXT_PUBLIC_GOOGLE_CLIENT_ID missing");
  const sdk = await getSdk();
  const deviceId = await sdk.getDeviceId();
  const { deviceToken, deviceEncryptionKey } = await postJson<{ deviceToken: string; deviceEncryptionKey: string }>(
    "/api/circle/device-token",
    { deviceId },
  );
  store(DEVICE_KEY, { deviceToken, deviceEncryptionKey });
  store(RETURN_KEY, returnTo);
  sdk.updateConfigs({
    appSettings: { appId: APP_ID },
    loginConfigs: {
      deviceToken,
      deviceEncryptionKey,
      google: { clientId: GOOGLE_CLIENT_ID, redirectUri: redirectUri(), selectAccountPrompt: true },
    },
  });
  await sdk.performLogin("Google" as SocialLoginProvider);
}

/**
 * Step 2 (on /auth/callback): constructing the SDK with the same login config
 * makes it read the Google redirect and call back with the user token.
 */
export async function completeGoogleLogin(): Promise<{ session: CircleSession; returnTo: string }> {
  const device = load<{ deviceToken: string; deviceEncryptionKey: string }>(DEVICE_KEY);
  if (!device) throw new CircleClientError("NO_DEVICE", "Login session not found — start again");
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

  const result = await new Promise<{ userToken: string; encryptionKey: string; email?: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CircleClientError("TIMEOUT", "Google login timed out")), 30_000);
    new W3SSdk(
      {
        appSettings: { appId: APP_ID },
        loginConfigs: {
          deviceToken: device.deviceToken,
          deviceEncryptionKey: device.deviceEncryptionKey,
          google: { clientId: GOOGLE_CLIENT_ID, redirectUri: redirectUri(), selectAccountPrompt: true },
        },
      },
      (error, res) => {
        clearTimeout(timer);
        if (error || !res) {
          reject(new CircleClientError(String(error?.code ?? "LOGIN_FAILED"), error?.message ?? "Login failed"));
          return;
        }
        const email = "oAuthInfo" in res ? res.oAuthInfo?.socialUserInfo?.email : undefined;
        resolve({ userToken: res.userToken, encryptionKey: res.encryptionKey, email });
      },
    );
  });

  const session: CircleSession = { ...result, savedAt: Date.now() };
  saveSession(session);
  const returnTo = load<string>(RETURN_KEY) ?? "/";
  store(RETURN_KEY, null);
  return { session, returnTo };
}

/** Runs a challenge in Circle's UI; resolves when the user confirmed it. */
export async function executeChallenge(session: CircleSession, challengeId: string): Promise<void> {
  const sdk = await getSdk();
  sdk.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });
  await new Promise<void>((resolve, reject) => {
    sdk.execute(challengeId, (error, result) => {
      if (error) {
        // 155701: user cancelled (closed the dialog) — see Circle SDK error codes.
        const code = error.code === 155701 ? "USER_CANCELLED" : String(error.code ?? "TX_FAILED");
        reject(new CircleClientError(code, error.message));
        return;
      }
      if (result && "status" in result && String(result.status).toUpperCase() === "FAILED") {
        reject(new CircleClientError("TX_FAILED", "Challenge failed"));
        return;
      }
      resolve();
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ensures the user has an Arc wallet (creates it via a challenge on first login). */
export async function ensureWallet(session: CircleSession, onCreating?: () => void): Promise<CircleSession> {
  type InitRes = { status: "CHALLENGE"; challengeId: string } | { status: "READY"; wallet: { id: string; address: string } } | { status: "PENDING" };
  let res = await postJson<InitRes>("/api/circle/init-user", { userToken: session.userToken, email: session.email });
  if (res.status === "CHALLENGE") {
    onCreating?.();
    await executeChallenge(session, res.challengeId);
  }
  for (let i = 0; i < 20 && res.status !== "READY"; i++) {
    await sleep(1500);
    res = await postJson<InitRes>("/api/circle/init-user", { userToken: session.userToken, email: session.email });
  }
  if (res.status !== "READY") throw new CircleClientError("TIMEOUT", "Wallet creation is taking too long — try again");
  const next = { ...session, walletId: res.wallet.id, walletAddress: res.wallet.address };
  saveSession(next);
  return next;
}

export function logout() {
  saveSession(null);
  store(DEVICE_KEY, null);
}
