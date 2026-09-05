import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBankDestinationContext, evaluateCurrentBankDestination } from "../app/lib/bank-destination-domain.ts";
import { canReviewFinancialIdentity } from "../app/lib/financial-review-domain.ts";
import { validateTckn, validateTrIban, validateVkn } from "../app/lib/financial-identity-validation.ts";
import { evaluateFinancialIdentityTrust, evaluatePayoutTransferEligibility, meetsFinancialAssurance } from "../app/lib/payout-eligibility-domain.ts";
import { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability } from "../app/lib/tax-verification-domain.ts";
import { decideCatalogMatch, parseGtin } from "../app/lib/catalog-intelligence.ts";
import { carrierEventDecision } from "../app/lib/shipping.ts";
import { classifyReplay, compareTrustBinding, evaluateApplicability, isSafeReasonCode, type TrustBinding, type ValidationOutcome } from "../app/lib/trust-primitives.ts";

const validSource = { kind: "MANUAL", authenticated: true, evidencePresent: true } as const;
const applicable = (overrides: Partial<Parameters<typeof evaluateApplicability>[0]> = {}) => evaluateApplicability({
  verified: true, source: validSource, bindingMatches: true, current: true, policySatisfied: true, ...overrides,
});

const localValidation: ValidationOutcome<"INVALID"> = { valid: true, reasonCode: null };
assert.equal(localValidation.valid, true);
assert.equal(validateTrIban("TR470000100100000350930001").assurance, "LOCAL_CHECKS_ONLY");
assert.equal(validateTckn("10000000146").assurance, "LOCAL_CHECKS_ONLY");
assert.equal(validateVkn("1234567890").assurance, "LOCAL_CHECKS_ONLY");
assert.equal(applicable({ verified: false }).applicable, false, "validated data is not automatically verified");
assert.equal(applicable({ source: { kind: "PROVIDER", authenticated: false, evidencePresent: true } }).applicable, false, "provider-shaped input is not authenticated evidence");
assert.equal(applicable({ source: { kind: "MANUAL", authenticated: true, evidencePresent: false } }).applicable, false);
assert.equal(applicable({ source: undefined }).applicable, false, "missing source context must fail closed");
assert.equal(applicable({ bindingMatches: false }).applicable, false);
assert.equal(applicable({ current: false }).applicable, false);
assert.equal(applicable({ policySatisfied: false }).applicable, false);
for (const flag of ["unknown", "malformed", "revoked", "expired", "superseded"] as const) assert.equal(applicable({ [flag]: true }).applicable, false, `${flag} must fail closed`);
assert.equal(applicable({ policySatisfied: false }).trusted, true, "domain policy controls applicability, not evidence trust");

const expected = { parts: ["seller-a", 7, "fingerprint-a", "PAYOUT"] } as const satisfies TrustBinding;
assert.equal(compareTrustBinding(expected, { parts: ["seller-a", 7, "fingerprint-a", "PAYOUT"] }), true);
assert.equal(compareTrustBinding(expected, { parts: ["seller-b", 7, "fingerprint-a", "PAYOUT"] }), false);
assert.equal(compareTrustBinding(expected, { parts: ["seller-a", 8, "fingerprint-a", "PAYOUT"] }), false);
assert.equal(compareTrustBinding(expected, { parts: ["seller-a", 7, "fingerprint-b", "PAYOUT"] }), false);
assert.equal(compareTrustBinding(expected, { parts: ["seller-a", 7, "fingerprint-a"] }), false);
assert.equal(compareTrustBinding(expected, null), false);
assert.equal(classifyReplay({ sameKey: false, bindingMatches: false, intentMatches: false }), "NEW");
assert.equal(classifyReplay({ sameKey: true, bindingMatches: true, intentMatches: true }), "SAFE_REPLAY");
assert.equal(classifyReplay({ sameKey: true, bindingMatches: false, intentMatches: true }), "CONFLICT");
assert.equal(classifyReplay({ sameKey: true, bindingMatches: true, intentMatches: false }), "CONFLICT");
for (const code of ["STALE_CONTEXT", "PAYMENT:REVIEW_REQUIRED", "BANK-REVOKED"]) assert.equal(isSafeReasonCode(code), true);
for (const unsafe of ["", "contains space", "raw@example.test", "a".repeat(101), null]) assert.equal(isSafeReasonCode(unsafe), false);

const profile = { id: "seller-a", onboardingVersion: 7, taxNumber: "10000000146", legalName: "Synthetic A.Ş.", companyType: "Anonim", taxOffice: "Test" };
const taxContext = buildCurrentTaxVerificationContext(profile, "TCKN");
const tax = { ...taxContext, verificationStatus: "VERIFIED" as const, verificationAssurance: "DOCUMENT_REVIEWED" as const };
assert.equal(evaluateTaxVerificationApplicability(tax, taxContext).applicable, true);
assert.equal(evaluateTaxVerificationApplicability({ ...tax, verificationAssurance: "LOCAL_CHECKS_ONLY" }, taxContext).applicable, false);
assert.equal(evaluateTaxVerificationApplicability({ ...tax, verificationAssurance: "PROVIDER_VERIFIED" }, taxContext).applicable, true);
assert.equal(evaluateTaxVerificationApplicability({ ...tax, verificationAssurance: "AUTHORITY_VERIFIED" }, taxContext).applicable, true);
assert.equal(evaluateTaxVerificationApplicability({ ...tax, sellerId: "seller-b" }, taxContext).applicable, false);
assert.equal(evaluateTaxVerificationApplicability({ ...tax, onboardingVersion: 6 }, taxContext).applicable, false);
assert.equal(evaluateTaxVerificationApplicability({ ...tax, normalizedFingerprint: "f".repeat(64) }, taxContext).applicable, false);

const bankContext = buildBankDestinationContext({ financialIdentityId: "identity-a", iban: "TR330006100519786457841326", beneficiaryName: "Synthetic A.Ş." });
const bankRevision = { id: "revision-2", financialIdentityId: "identity-a", destinationVersion: 2, canonicalIban: bankContext.canonicalIban, beneficiaryName: bankContext.beneficiaryName, normalizedFingerprint: bankContext.normalizedFingerprint };
assert.equal(evaluateCurrentBankDestination({ id: "identity-a", currentBankDestinationRevisionId: "revision-2" }, bankRevision).current, true);
assert.equal(evaluateCurrentBankDestination({ id: "identity-a", currentBankDestinationRevisionId: "revision-1" }, bankRevision).current, false);
assert.equal(evaluateCurrentBankDestination({ id: "identity-b", currentBankDestinationRevisionId: "revision-2" }, bankRevision).current, false);
assert.equal(canReviewFinancialIdentity({ role: "ADMIN", financialIdentityReviewerEnabled: false }), false);
assert.equal(canReviewFinancialIdentity({ role: "ADMIN", financialIdentityReviewerEnabled: true }), true);
assert.equal(meetsFinancialAssurance("LOCAL_CHECKS_ONLY"), false);
assert.equal(meetsFinancialAssurance("DOCUMENT_REVIEWED"), true);
assert.deepEqual(evaluateFinancialIdentityTrust({ onboardingStatus: "APPROVED", activationEligible: true, taxTrusted: true, bankTrusted: true }), { trusted: true, reasons: [] });
const held = evaluatePayoutTransferEligibility({ onboardingStatus: "APPROVED", activationEligible: true, sellerStatus: "APPROVED", taxTrusted: true, bankTrusted: true, holdActive: true, payoutStatus: "AVAILABLE", hasBlockingRefundOrDispute: false });
assert.equal(held.transferEligible, false);
assert.deepEqual(held.reasons, ["FINANCIAL_HOLD_ACTIVE"]);

assert.equal(decideCatalogMatch({ gtin: parseGtin("4006381333931"), sellerSku: null, normalizedName: "x", normalizedBrand: "y", normalizedModel: null, candidates: [] }).type, "NEW_CATALOG_PRODUCT");
assert.deepEqual(carrierEventDecision("OUT_FOR_DELIVERY", "IN_TRANSIT", new Date("2026-08-20T11:00:00Z"), new Date("2026-08-20T12:00:00Z")), { apply: false, stale: true, equivalent: false });
const root = resolve(import.meta.dirname, "..");
for (const file of ["app/lib/payment-orchestrator.ts", "app/lib/stock-truth.ts", "app/lib/catalog-intelligence.ts", "app/lib/shipping.ts"]) {
  const source = readFileSync(resolve(root, file), "utf8");
  assert.doesNotMatch(source, /FinancialVerificationAssurance|trust-primitives/, `${file} must retain domain-owned policy`);
}

console.log("PASS: #21 Slice A shared vocabulary, fail-closed applicability, binding/replay safety and cross-domain non-coupling");
