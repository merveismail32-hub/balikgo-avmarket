import { strict as assert } from "node:assert";
import { TEST_DB_IDENTITY, validateTestDatabaseEnvironment } from "./guarded-test-prisma.ts";

const password = "not-a-secret";
const valid = `postgresql://${encodeURIComponent(TEST_DB_IDENTITY.user)}:${password}@${TEST_DB_IDENTITY.host}:5432/postgres`;
const rejects = (databaseUrl: string | undefined, ca = "local-ca.pem") => assert.throws(() => validateTestDatabaseEnvironment({ DATABASE_URL: databaseUrl, SUPABASE_CA_CERT_PATH: ca }), /REFUSING_|MISSING/);
assert.doesNotThrow(() => validateTestDatabaseEnvironment({ DATABASE_URL: valid, SUPABASE_CA_CERT_PATH: "local-ca.pem" }));
rejects(valid.replace(TEST_DB_IDENTITY.projectRef, "lkvzkscoworbudceknbo"));
rejects(valid.replace(TEST_DB_IDENTITY.host, "db.example.invalid"));
rejects(valid.replace(":5432/", ":6543/"));
rejects(valid.replace("/postgres", "/other"));
rejects(undefined);
rejects(valid, "");
rejects(`${valid}?sslmode=no-verify`);
console.log("PASS: TEST DB guard rejects production ref, host/port/database mismatch, DIRECT_URL-only, missing CA and insecure TLS.");
