import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export const TEST_DB_IDENTITY = { host: "aws-0-ap-northeast-1.pooler.supabase.com", user: "postgres.ikfalxycwusprjnhnxzf", projectRef: "ikfalxycwusprjnhnxzf", port: "5432", database: "postgres" } as const;
type TestEnvironment = { DATABASE_URL?: string; SUPABASE_CA_CERT_PATH?: string };

export function validateTestDatabaseEnvironment(env: TestEnvironment) {
  if (!env.DATABASE_URL) throw new Error("TEST_DATABASE_URL_MISSING");
  if (!env.SUPABASE_CA_CERT_PATH) throw new Error("SUPABASE_CA_CERT_PATH_MISSING");
  const target = new URL(env.DATABASE_URL);
  if (target.hostname !== TEST_DB_IDENTITY.host || target.port !== TEST_DB_IDENTITY.port || decodeURIComponent(target.username) !== TEST_DB_IDENTITY.user || target.pathname !== `/${TEST_DB_IDENTITY.database}`) throw new Error("REFUSING_NON_TEST_DATABASE");
  if (/(?:sslmode=(?:disable|no-verify)|rejectUnauthorized=false|uselibpqcompat=true)/i.test(target.search)) throw new Error("REFUSING_INSECURE_TLS_CONFIGURATION");
  return { connectionString: env.DATABASE_URL, caPath: env.SUPABASE_CA_CERT_PATH };
}

export function guardedTestConnectionOptions(env: TestEnvironment = { DATABASE_URL: process.env.DATABASE_URL, SUPABASE_CA_CERT_PATH: process.env.SUPABASE_CA_CERT_PATH }) {
  const safe = validateTestDatabaseEnvironment(env);
  return { connectionString: safe.connectionString, ssl: { ca: readFileSync(safe.caPath, "utf8"), rejectUnauthorized: true as const } };
}

export function createGuardedTestPrisma(env: TestEnvironment = { DATABASE_URL: process.env.DATABASE_URL, SUPABASE_CA_CERT_PATH: process.env.SUPABASE_CA_CERT_PATH }) {
  return new PrismaClient({ adapter: new PrismaPg(guardedTestConnectionOptions(env)), transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
}
