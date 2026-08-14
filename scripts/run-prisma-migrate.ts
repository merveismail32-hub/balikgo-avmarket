import "dotenv/config";
import { spawnSync } from "node:child_process";
import { validateOperationTarget } from "./guarded-operation-prisma";

const mode = process.argv[2];
if (mode !== "test" && mode !== "production") throw new Error("MIGRATION_MODE_REQUIRED");
const safe = validateOperationTarget(process.env, "write");
if (mode === "test" && safe.actualRef !== "ikfalxycwusprjnhnxzf") throw new Error("TEST_MIGRATION_REFUSED_NON_TEST_PROJECT");
if (mode === "production" && safe.actualRef !== "lkvzkscoworbudceknbo") throw new Error("PRODUCTION_MIGRATION_REFUSED_NON_PRODUCTION_PROJECT");
if (!process.env.SUPABASE_CA_CERT_PATH) throw new Error("SUPABASE_CA_CERT_PATH_MISSING");
const env = { ...process.env, DIRECT_URL: safe.connectionString, NODE_EXTRA_CA_CERTS: process.env.SUPABASE_CA_CERT_PATH };
const result = spawnSync("npx.cmd", ["prisma", "migrate", "deploy"], { stdio: "inherit", env, shell: false });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
