import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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

export function createGuardedOperationPrisma(operation: string, access: "read" | "write") {
  const { connectionString, target, actualRef } = validateOperationTarget(process.env, access);
  const caPath = process.env.SUPABASE_CA_CERT_PATH;
  if (target.hostname.includes("supabase") && !caPath) throw new Error("SUPABASE_CA_CERT_PATH_MISSING");
  console.log(`DB target verified: projectRef=${actualRef}, operation=${operation}, access=${access}`);
  const ssl = caPath ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true as const } : undefined;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl }) });
}
