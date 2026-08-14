import { strict as assert } from "node:assert";
import { validateOperationTarget } from "./guarded-operation-prisma.ts";

const uri = (ref: string) => `postgresql://postgres.${ref}:password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
assert.throws(() => validateOperationTarget({ DIRECT_URL: uri("lkvzkscoworbudceknbo"), DB_TARGET_PROJECT_REF: "lkvzkscoworbudceknbo" }, "write"), /EXPLICIT_CONFIRMATION/);
assert.doesNotThrow(() => validateOperationTarget({ DIRECT_URL: uri("lkvzkscoworbudceknbo"), DB_TARGET_PROJECT_REF: "lkvzkscoworbudceknbo" }, "read"));
assert.throws(() => validateOperationTarget({ DIRECT_URL: uri("other"), DB_TARGET_PROJECT_REF: "expected" }, "read"), /MISMATCH/);
assert.throws(() => validateOperationTarget({ DIRECT_URL: uri("other") }, "read"), /REQUIRED/);
console.log("PASS: operational target guard requires identity match and explicit production write confirmation.");
