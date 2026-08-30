import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export const TEST_DB_IDENTITY = { host: "aws-0-ap-northeast-1.pooler.supabase.com", user: "postgres.ikfalxycwusprjnhnxzf", projectRef: "ikfalxycwusprjnhnxzf", port: "5432", database: "postgres" } as const;
export const TEST_DIRECT_DB_IDENTITY = { host: "db.ikfalxycwusprjnhnxzf.supabase.co", user: "postgres", projectRef: "ikfalxycwusprjnhnxzf", port: "5432", database: "postgres" } as const;
type TestEnvironment = { DATABASE_URL?: string; SUPABASE_CA_CERT_PATH?: string };

export function validateTestDatabaseEnvironment(env: TestEnvironment) {
  if (!env.DATABASE_URL) throw new Error("TEST_DATABASE_URL_MISSING");
  if (!env.SUPABASE_CA_CERT_PATH) throw new Error("SUPABASE_CA_CERT_PATH_MISSING");
  const target = new URL(env.DATABASE_URL);
  if (target.hostname !== TEST_DB_IDENTITY.host || target.port !== TEST_DB_IDENTITY.port || decodeURIComponent(target.username) !== TEST_DB_IDENTITY.user || target.pathname !== `/${TEST_DB_IDENTITY.database}`) throw new Error("REFUSING_NON_TEST_DATABASE");
  if (/(?:sslmode=(?:disable|no-verify)|rejectUnauthorized=false|uselibpqcompat=true)/i.test(target.search)) throw new Error("REFUSING_INSECURE_TLS_CONFIGURATION");
  const runtime = new URL(env.DATABASE_URL);
  // node-postgres replaces an explicit verified `ssl.ca` object when SSL URL parameters are present.
  // Remove only non-bypass SSL selectors after identity/safety validation; the caller supplies the pinned CA.
  runtime.searchParams.delete("sslmode");
  runtime.searchParams.delete("sslrootcert");
  return { connectionString: env.DATABASE_URL, runtimeConnectionString: runtime.toString(), caPath: env.SUPABASE_CA_CERT_PATH };
}

export function verifiedTestMigrationConnectionString(env: { TEST_SESSION_DATABASE_URL?: string; SUPABASE_CA_CERT_PATH?: string }) {
  if (!env.TEST_SESSION_DATABASE_URL) throw new Error("TEST_SESSION_DATABASE_URL_MISSING");
  if (!env.SUPABASE_CA_CERT_PATH) throw new Error("SUPABASE_CA_CERT_PATH_MISSING");
  const target = new URL(env.TEST_SESSION_DATABASE_URL);
  if (target.hostname !== TEST_DB_IDENTITY.host || target.port !== TEST_DB_IDENTITY.port || decodeURIComponent(target.username) !== TEST_DB_IDENTITY.user || target.pathname !== `/${TEST_DB_IDENTITY.database}`) throw new Error("REFUSING_NON_TEST_MIGRATION_DATABASE");
  if (/(?:sslmode=(?:disable|no-verify)|rejectUnauthorized=false|uselibpqcompat=true)/i.test(target.search)) throw new Error("REFUSING_INSECURE_TLS_CONFIGURATION");
  target.searchParams.delete("sslrootcert");
  target.searchParams.set("sslmode", "require");
  target.searchParams.set("sslcert", env.SUPABASE_CA_CERT_PATH);
  target.searchParams.set("sslaccept", "strict");
  return target.toString();
}

export function guardedTestConnectionOptions(env: TestEnvironment = { DATABASE_URL: process.env.DATABASE_URL, SUPABASE_CA_CERT_PATH: process.env.SUPABASE_CA_CERT_PATH }) {
  const safe = validateTestDatabaseEnvironment(env);
  return { connectionString: safe.runtimeConnectionString, ssl: { ca: readFileSync(safe.caPath, "utf8"), rejectUnauthorized: true as const }, max: 2 };
}

export function createGuardedTestPrisma(env: TestEnvironment = { DATABASE_URL: process.env.DATABASE_URL, SUPABASE_CA_CERT_PATH: process.env.SUPABASE_CA_CERT_PATH }) {
  return new PrismaClient({ adapter: new PrismaPg(guardedTestConnectionOptions(env)), transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
}
