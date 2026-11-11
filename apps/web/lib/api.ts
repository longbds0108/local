import { NextResponse } from "next/server";
import { z } from "zod";
import { CIRCLE_CODES, CircleError } from "./circle";
import { ConfigError } from "./env";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INSUFFICIENT_USDC"
  | "ALLOWANCE_PENDING"
  | "EXPIRED"
  | "CIRCLE_ERROR"
  | "CHAIN_ERROR"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function jsonError(status: number, code: ApiErrorCode, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Body must be valid JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "BAD_REQUEST", "Invalid request", z.treeifyError(parsed.error));
  return parsed.data;
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new ApiError(400, "BAD_REQUEST", "Invalid query", z.treeifyError(parsed.error));
  return parsed.data;
}

/** Wraps a route handler with uniform error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err.status, err.code, err.message, err.details);
      if (err instanceof ConfigError) return jsonError(503, "NOT_CONFIGURED", err.message);
      if (err instanceof CircleError) {
        const expired =
          err.code === CIRCLE_CODES.userTokenExpired ||
          err.code === CIRCLE_CODES.userTokenInvalid ||
          err.code === CIRCLE_CODES.userTokenNotFound ||
          err.status === 401;
        if (expired) return jsonError(401, "UNAUTHORIZED", "Circle session expired — please reconnect your wallet");
        console.error("[circle]", err.status, err.code, err.message);
        return jsonError(502, "CIRCLE_ERROR", `Circle: ${err.message}`, { circleCode: err.code });
      }
      console.error("[api] unhandled error", err);
      return jsonError(500, "INTERNAL", "Internal error");
    }
  };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
