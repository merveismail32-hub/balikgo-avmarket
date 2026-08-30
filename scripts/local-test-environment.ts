import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEST_DB_IDENTITY } from "./guarded-test-prisma.ts";

function localValue(root: string, name: string) {
  try {
    const line = readFileSync(resolve(root, ".env.test.local"), "utf8").split(/\r?\n/).find((value) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(value));
    if (!line) return undefined;
    const raw = line.slice(line.indexOf("=") + 1).trim();
    return ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) ? raw.slice(1, -1) : raw;
  } catch { return undefined; }
}

export function hydrateVerifiedTestEnvironment(env: NodeJS.ProcessEnv, root: string) {
  if (env.DB_TARGET_PROJECT_REF && env.DB_TARGET_PROJECT_REF !== TEST_DB_IDENTITY.projectRef) throw new Error("DB_TARGET_PROJECT_REF_MISMATCH");
  const sessionUrl = env.TEST_SESSION_DATABASE_URL ?? localValue(root, "TEST_SESSION_DATABASE_URL");
  if (!sessionUrl) throw new Error("TEST_SESSION_DATABASE_URL_MISSING");
  return { ...env, DATABASE_URL: sessionUrl, TEST_SESSION_DATABASE_URL: sessionUrl, DB_TARGET_PROJECT_REF: TEST_DB_IDENTITY.projectRef } as NodeJS.ProcessEnv;
}
