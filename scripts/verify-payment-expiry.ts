import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { authorizeInternalJob, MIN_INTERNAL_CRON_SECRET_LENGTH } from "../app/lib/internal-job-auth.ts";
import { paymentReconciliationFingerprint } from "../app/lib/payment-reconciliation.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../prisma/schema.prisma");
const migration = read("../prisma/migrations/20260815210000_payment_expiry_phase_2_package_2/migration.sql");
const expiry = read("../app/lib/payment-expiry.ts");
const route = read("../app/api/internal/jobs/expire-payment-reservations/route.ts");
const payment = read("../app/lib/payment-orchestrator.ts");
const deployment = ["../vercel.json"].map((path) => { try { return read(path); } catch { return ""; } }).join("\n");

assert.match(schema, /\bEXPIRED\b/);
assert.match(schema, /expiryClaimToken\s+String\?/);
assert.match(schema, /openFingerprint\s+String\?\s+@unique/);
assert(!/^\s*(?:UPDATE|DELETE|DROP|TRUNCATE)\b/im.test(migration));
assert.match(expiry, /FOR UPDATE SKIP LOCKED/);
assert.match(expiry, /PAYMENT_EXPIRY_BATCH_MAX = 25/);
assert.match(expiry, /PAYMENT_EXPIRY_LEASE_MS = 5 \* 60_000/);
assert.match(expiry, /ORDER BY "reservationExpiresAt" ASC, "id" ASC/);
assert.match(expiry, /randomBytes\(32\)/);
assert.match(expiry, /releaseOrderReservation/);
assert.match(expiry, /EXPIRY_FULFILLMENT_CONFLICT/);
assert.match(route, /runtime = "nodejs"/);
assert.match(route, /Cache-Control.*no-store/);
assert(!/request\.(?:json|text)|searchParams/.test(route));
assert.match(payment, /createOrGetPaymentReconciliationReview/);
assert.match(payment, /\["FAILED", "EXPIRED", "CANCELLED"\]/);
assert(!/cron/i.test(deployment));

const secret = "s".repeat(MIN_INTERNAL_CRON_SECRET_LENGTH);
const request = (authorization?: string) => new Request("https://invalid.local/api/internal/jobs/expire-payment-reservations", { method: "POST", headers: authorization ? { authorization } : {} });
assert.equal(authorizeInternalJob(request(), secret), false);
assert.equal(authorizeInternalJob(request(`Bearer ${secret}`), undefined), false);
assert.equal(authorizeInternalJob(request(`Bearer ${"s".repeat(MIN_INTERNAL_CRON_SECRET_LENGTH - 1)}`), secret), false);
assert.equal(authorizeInternalJob(request(`Bearer ${"x".repeat(MIN_INTERNAL_CRON_SECRET_LENGTH)}`), secret), false);
assert.equal(authorizeInternalJob(request(`Bearer ${secret}`), secret), true);

const identity = { paymentId: "opaque-payment", reason: "LATE_PAYMENT_SUCCESS" as const, terminalStatus: "EXPIRED" as const };
const first = paymentReconciliationFingerprint(identity);
assert.equal(first.length, 64);
assert.equal(first, paymentReconciliationFingerprint(identity));
assert.equal(first, paymentReconciliationFingerprint({ ...identity }));
assert.notEqual(first, paymentReconciliationFingerprint({ ...identity, terminalStatus: "FAILED" }));
console.log("PASS: payment expiry lease, internal auth, dark launch and reconciliation fingerprint verified.");
