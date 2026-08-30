import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { TEST_DB_IDENTITY, validateTestDatabaseEnvironment, verifiedTestMigrationConnectionString } from "./guarded-test-prisma.ts";

const PRODUCTION_REF = "lkvzkscoworbudceknbo";
const PRODUCTION_CONFIRMATION = "I_ACKNOWLEDGE_BALIKGO_PRODUCTION_WRITE";

export function projectRef(target: URL) {
  return target.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? decodeURIComponent(target.username).match(/^postgres\.([a-z0-9]+)$/i)?.[1] ?? null;
}

export function validateOperationTarget(env: Record<string, string | undefined>, access: "read" | "write") {
  const connectionString = env.DIRECT_URL ?? env.DATABASE_URL;
  const expectedRef = env.DB_TARGET_PROJECT_REF;
  if (!connectionString || !expectedRef) throw new Error("DB_TARGET_AND_EXPECTED_PROJECT_REF_REQUIRED");
  const target = new URL(connectionString);
  const actualRef = projectRef(target);
  if (!actualRef || actualRef !== expectedRef) throw new Error("DB_TARGET_PROJECT_REF_MISMATCH");
  if (access === "write" && actualRef === PRODUCTION_REF && env.ALLOW_PRODUCTION_DB_OPERATION !== PRODUCTION_CONFIRMATION) throw new Error("PRODUCTION_WRITE_REQUIRES_EXPLICIT_CONFIRMATION");
  return { connectionString, target, actualRef };
}

export type MigrationTarget = "test" | "production";

function rejectTlsBypass(env: Record<string, string | undefined>) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("REFUSING_INSECURE_TLS_ENVIRONMENT");
}

export function selectMigrationTarget(env: Record<string, string | undefined>, target: string | undefined) {
  rejectTlsBypass(env);
  if (target === "test") {
    if (env.DB_TARGET_PROJECT_REF !== TEST_DB_IDENTITY.projectRef) throw new Error("DB_TARGET_PROJECT_REF_MISMATCH");
    validateTestDatabaseEnvironment({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
    const connectionString = verifiedTestMigrationConnectionString({ TEST_SESSION_DATABASE_URL: env.TEST_SESSION_DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
    return { operationTarget: target, connectionString, actualRef: TEST_DB_IDENTITY.projectRef } as const;
  }
  if (target === "production") {
    const safe = validateOperationTarget(env, "write");
    if (safe.actualRef !== PRODUCTION_REF) throw new Error("PRODUCTION_MIGRATION_REFUSED_NON_PRODUCTION_PROJECT");
    return { operationTarget: target, connectionString: safe.connectionString, actualRef: safe.actualRef } as const;
  }
  throw new Error("MIGRATION_MODE_REQUIRED");
}

export function migrationChildEnvironment(env: Record<string, string | undefined>, selected: ReturnType<typeof selectMigrationTarget>) {
  if (!env.SUPABASE_CA_CERT_PATH) throw new Error("SUPABASE_CA_CERT_PATH_MISSING");
  return { ...env, DATABASE_URL: selected.connectionString, DIRECT_URL: selected.connectionString, NODE_EXTRA_CA_CERTS: env.SUPABASE_CA_CERT_PATH, PGSSLROOTCERT: env.SUPABASE_CA_CERT_PATH, SSL_CERT_FILE: env.SUPABASE_CA_CERT_PATH };
}

export function createGuardedOperationPrisma(operation: string, access: "read" | "write") {
  const { connectionString, target, actualRef } = validateOperationTarget(process.env, access);
  const caPath = process.env.SUPABASE_CA_CERT_PATH;
  if (target.hostname.includes("supabase") && !caPath) throw new Error("SUPABASE_CA_CERT_PATH_MISSING");
  console.log(`DB target verified: projectRef=${actualRef}, operation=${operation}, access=${access}`);
  const ssl = caPath ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true as const } : undefined;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl }) });
}
