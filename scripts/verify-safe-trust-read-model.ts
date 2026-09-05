import assert from "node:assert/strict";
import { toFinancialTrustView } from "../app/lib/financial-trust-adapters";
import { toProviderBoundarySafeView, type ProviderBoundaryDecision } from "../app/lib/provider-trust-boundary";
import { toTrustTelemetryDescriptor } from "../app/lib/safe-trust-read-model";

const financial = toFinancialTrustView({
  status: "VERIFIED",
  source: "MANUAL",
  sourceAuthenticated: true,
  decision: { trusted: true, verified: true, bindingMatches: true, current: true, applicable: false, policySatisfied: false, reasonCodes: ["INSUFFICIENT_POLICY"] },
  observedAt: new Date("2026-09-02T10:00:00Z"),
  verifiedAt: new Date("2026-09-02T10:01:00Z"),
  maskedSubject: "•••• 0146",
});
assert.equal(financial.trusted, true);
assert.equal(financial.applicable, false);
assert.deepEqual(financial.reasonCodes, ["INSUFFICIENT_POLICY"]);
assert.equal(financial.subjectSummary, "•••• 0146");
assert.equal(toFinancialTrustView({
  status: "VERIFIED",
  source: "MANUAL",
  sourceAuthenticated: true,
  decision: financial.trusted
    ? { trusted: true, verified: true, bindingMatches: true, current: true, applicable: true, policySatisfied: true, reasonCodes: [] }
    : { trusted: false, verified: false, bindingMatches: false, current: false, applicable: false, policySatisfied: false, reasonCodes: ["UNKNOWN"] },
  maskedSubject: "10000000146",
}).subjectSummary, undefined);

const providerDecision: ProviderBoundaryDecision = {
  authenticated: false,
  result: "UNKNOWN",
  identityMatches: true,
  bindingMatches: true,
  evidencePresent: true,
  replay: "CONFLICT",
  readyForDomainEvaluation: false,
  reasonCodes: ["SOURCE_UNAUTHENTICATED", "PROVIDER_RESULT_UNKNOWN", "REPLAY_CONFLICT"],
  provenance: {
    provider: "secret-provider-identity",
    accountReference: "secret-account",
    environment: "production",
    externalEventId: "evt-secret",
    reference: "raw-reference",
    verificationMethod: "SIGNED_WEBHOOK",
    receivedAt: "2026-09-02T11:00:00.000Z",
    decidedAt: null,
  },
};
const provider = toProviderBoundarySafeView(providerDecision);
const serializedProvider = JSON.stringify(provider);
assert.equal(provider.source.authenticity, "UNAUTHENTICATED");
assert.equal(provider.outcome, "UNKNOWN");
assert.equal(provider.applicable, false);
assert.equal(provider.replay, "CONFLICT");
for (const secret of ["secret-provider-identity", "secret-account", "production", "evt-secret", "raw-reference"]) assert(!serializedProvider.includes(secret));

const stale = toFinancialTrustView({
  status: "VERIFIED",
  source: "MANUAL",
  sourceAuthenticated: true,
  decision: { trusted: false, verified: true, bindingMatches: false, current: false, applicable: false, policySatisfied: true, reasonCodes: ["WRONG_BINDING", "STALE"] },
  revoked: true,
  expired: true,
  superseded: true,
});
assert.deepEqual(stale.invalidation, { stale: true, revoked: true, expired: true, superseded: true });

const telemetryInput = {
  domain: "FINANCE" as const,
  category: "TAX_VERIFICATION",
  trusted: financial.trusted,
  current: financial.current,
  applicable: financial.applicable,
  reasonCodes: [...financial.reasonCodes, "unsafe free text"],
  occurredAt: new Date("2026-09-02T12:00:00Z"),
  correlationReference: "CORRELATION_42",
};
const before = JSON.stringify(telemetryInput);
const telemetry = toTrustTelemetryDescriptor(telemetryInput);
assert.equal(JSON.stringify(telemetryInput), before);
assert.equal(telemetry.result, "DENIED");
assert.deepEqual(telemetry.reasonCodes, ["INSUFFICIENT_POLICY"]);
assert(!JSON.stringify(telemetry).includes("unsafe free text"));
assert.equal(toTrustTelemetryDescriptor({ ...telemetryInput, correlationReference: "raw pii value" }).correlationReference, null);

console.log("PASS: #21 Slice E safe trust read-model and observability contract");
