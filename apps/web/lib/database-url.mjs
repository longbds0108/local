// Finds the Postgres connection strings whatever the hosting provider named them.
// Vercel's Neon / Supabase / Postgres integrations create DATABASE_URL, POSTGRES_URL,
// POSTGRES_PRISMA_URL, … and, when a custom prefix is chosen, MYDB_DATABASE_URL and so on.
// Shared by scripts/build-postgres.mjs (build) and lib/db.ts (runtime).

const isPostgres = (v) => typeof v === "string" && /^postgres(ql)?:\/\//.test(v.trim());

const DIRECT_HINT = /(UNPOOLED|NON_POOLING|DIRECT)/;
const POOLED_NAMES = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "NEON_DATABASE_URL", "SUPABASE_DB_URL"];
const DIRECT_NAMES = ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];

function pick(env, names, filter) {
  for (const name of names) if (isPostgres(env[name])) return { name, url: env[name].trim() };
  // Prefixed variants (e.g. STORAGE_DATABASE_URL), then any variable holding a Postgres URL.
  for (const name of names) {
    const hit = Object.keys(env).sort().find((k) => k.endsWith(`_${name}`) && isPostgres(env[k]));
    if (hit) return { name: hit, url: env[hit].trim() };
  }
  const any = Object.keys(env).sort().find((k) => filter(k) && isPostgres(env[k]));
  return any ? { name: any, url: env[any].trim() } : undefined;
}

/** Pooled URL for queries, or undefined when no Postgres URL is configured. */
export function findPostgresUrl(env = process.env) {
  return pick(env, POOLED_NAMES, (k) => !DIRECT_HINT.test(k)) ?? pick(env, DIRECT_NAMES, () => true);
}

/** Direct (non-pooled) URL for schema changes, if the provider gives one. */
export function findDirectPostgresUrl(env = process.env) {
  return pick(env, DIRECT_NAMES, (k) => DIRECT_HINT.test(k));
}
