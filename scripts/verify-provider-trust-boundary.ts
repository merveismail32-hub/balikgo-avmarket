import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineProviderTrustAdapter, evaluateProviderBoundary, type ProviderResultSemantics } from "../app/lib/provider-trust-boundary.ts";
import { isSafeReasonCode, type TrustBinding } from "../app/lib/trust-primitives.ts";

type SyntheticMessage = Readonly<{ authentic: boolean; status: ProviderResultSemantics; ignoredPayload?: string }>;
const adapter = defineProviderTrustAdapter<SyntheticMessage>({
  authenticate: (message) => message.authentic,
  normalizeResult: (message) => message.status,
});
const identity = { provider: "SYNTHETIC_BANK", accountReference: "merchant-test-a", environment: "SANDBOX" } as const;
type ProviderBinding = TrustBinding<readonly [string, number, string, string, string, string, string]>;
const binding: ProviderBinding = { parts: ["seller-a", 4, "fingerprint-a", "VERIFY_BANK_DESTINATION", identity.provider, identity.accountReference, identity.environment] };
const evidence = { externalEventId: "event-1", reference: "synthetic-reference-1", verificationMethod: "SIGNED_WEBHOOK", receivedAt: new Date("2026-09-02T12:00:00Z"), decidedAt: new Date("2026-09-02T11:59:59Z") };
const evaluate = (overrides: Partial<Parameters<typeof evaluateProviderBoundary<SyntheticMessage, ProviderBinding["parts"]>>[0]> = {}) => evaluateProviderBoundary({
  adapter,
  message: { authentic: true, status: "POSITIVE", ignoredPayload: "raw-sensitive-provider-body" },
  expectedIdentity: identity,
  observedIdentity: identity,
  expectedBinding: binding,
  observedBinding: binding,
  intent: "VERIFY_BANK_DESTINATION",
  evidence,
  ...overrides,
});

const positive = evaluate();
assert.equal(positive.readyForDomainEvaluation, true);
assert.equal(positive.authenticated, true);
assert.equal(positive.result, "POSITIVE");
assert.equal("applicable" in positive, false, "provider boundary must not authorize a business action");
assert(!JSON.stringify(positive).includes("raw-sensitive-provider-body"));
assert.equal(evaluate({ message: { authentic: false, status: "POSITIVE" } }).readyForDomainEvaluation, false);
assert.deepEqual(evaluate({ message: { authentic: false, status: "POSITIVE" } }).reasonCodes, ["SOURCE_UNAUTHENTICATED"]);
assert.equal(evaluate({ message: { authentic: true, status: "NEGATIVE" } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ message: { authentic: true, status: "UNKNOWN" } }).readyForDomainEvaluation, false);
const timeoutAdapter = defineProviderTrustAdapter<SyntheticMessage>({ authenticate: () => true, normalizeResult: () => { throw new Error("timeout detail must not escape"); } });
assert.equal(evaluate({ adapter: timeoutAdapter }).result, "UNKNOWN");
assert.equal(evaluate({ adapter: timeoutAdapter }).readyForDomainEvaluation, false);
assert.equal(evaluate({ evidence: null }).readyForDomainEvaluation, false);
assert.equal(evaluate({ evidence: { ...evidence, reference: "unsafe provider error text" } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ observedIdentity: { ...identity, provider: "OTHER_PROVIDER" } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ observedIdentity: { ...identity, accountReference: "merchant-test-b" } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ expectedIdentity: { ...identity, environment: "PRODUCTION" } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ observedIdentity: { provider: "", accountReference: "", environment: "" } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ intent: "" }).readyForDomainEvaluation, false);
assert.equal(evaluate({ observedBinding: { parts: ["seller-b", 4, "fingerprint-a", "VERIFY_BANK_DESTINATION", identity.provider, identity.accountReference, identity.environment] } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ observedBinding: { parts: ["seller-a", 5, "fingerprint-a", "VERIFY_BANK_DESTINATION", identity.provider, identity.accountReference, identity.environment] } }).readyForDomainEvaluation, false);
assert.equal(evaluate({ observedBinding: { parts: ["seller-a", 4, "fingerprint-b", "VERIFY_BANK_DESTINATION", identity.provider, identity.accountReference, identity.environment] } }).readyForDomainEvaluation, false);

const priorEvent = { externalEventId: evidence.externalEventId, binding, intent: "VERIFY_BANK_DESTINATION" } as const;
assert.equal(evaluate({ priorEvent }).replay, "SAFE_REPLAY");
assert.equal(evaluate({ priorEvent, observedBinding: { parts: ["seller-b", 4, "fingerprint-a", "VERIFY_BANK_DESTINATION", identity.provider, identity.accountReference, identity.environment] } }).replay, "CONFLICT");
assert.equal(evaluate({ priorEvent: { ...priorEvent, intent: "VERIFY_TAX_IDENTITY" } }).replay, "CONFLICT");
assert.equal(evaluate({ evidence: { ...evidence, externalEventId: "event-2" }, priorEvent }).replay, "NEW");
for (const code of ["SOURCE_UNAUTHENTICATED", "EVIDENCE_MISSING", "PROVIDER_MISMATCH", "ACCOUNT_MISMATCH", "ENVIRONMENT_MISMATCH", "BINDING_MISMATCH", "PROVIDER_RESULT_UNKNOWN", "REPLAY_CONFLICT"]) assert.equal(isSafeReasonCode(code), true);

const root = resolve(import.meta.dirname, "..");
const boundarySource = readFileSync(resolve(root, "app/lib/provider-trust-boundary.ts"), "utf8");
assert.doesNotMatch(boundarySource, /FinancialVerificationAssurance|PaymentStatus|PayoutStatus|StockMovement|CatalogMatchStatus|ShipmentStatus/);
for (const file of ["app/lib/payment-orchestrator.ts", "app/lib/financial-trust-adapters.ts", "app/lib/stock-truth.ts", "app/lib/catalog-intelligence.ts", "app/lib/shipping.ts"]) {
  assert.doesNotMatch(readFileSync(resolve(root, file), "utf8"), /provider-trust-boundary/, `${file} must remain domain-owned in Slice C`);
}

console.log("PASS: #21 Slice C provider authenticity, result, provenance, identity/binding and replay boundaries fail closed without business applicability");
