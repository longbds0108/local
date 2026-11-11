import { PrismaClient } from "@prisma/client";
import { findPostgresUrl } from "./database-url.mjs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Local dev keeps DATABASE_URL=file:./dev.db (SQLite). On Vercel the database
// integration may name the Postgres URL differently (POSTGRES_URL, a prefixed name, …).
function datasourceUrl(): string | undefined {
  const current = process.env.DATABASE_URL?.trim();
  if (current && (current.startsWith("postgres") || !process.env.VERCEL)) return undefined;
  return findPostgresUrl()?.url;
}

const url = datasourceUrl();
export const prisma = globalForPrisma.prisma ?? new PrismaClient(url ? { datasourceUrl: url } : undefined);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
