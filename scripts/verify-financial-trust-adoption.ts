import assert from "node:assert/strict";
import { evaluateBankDestinationTrust, evaluatePayoutTrust, evaluateTaxTrust } from "../app/lib/financial-trust-adapters.ts";
import { buildBankDestinationContext, evaluateCurrentBankDestination } from "../app/lib/bank-destination-domain.ts";
import { buildCurrentTaxVerificationContext } from "../app/lib/tax-verification-domain.ts";
import { isSafeReasonCode } from "../app/lib/trust-primitives.ts";

const profile = { id: "seller-a", onboardingVersion: 4, taxNumber: "10000000146", legalName: "Synthetic A.Ş.", companyType: "Anonim", taxOffice: "Test" };
const taxContext = buildCurrentTaxVerificationContext(profile, "TCKN");
const taxBase = { ...taxContext, verificationStatus: "VERIFIED" as const, verificationSource: "MANUAL" as const, verificationAssurance: "DOCUMENT_REVIEWED" as const };
const evidence = { evidencePresent: true, sourceAuthenticated: true };
const tax = evaluateTaxTrust(taxBase, taxContext, evidence);
assert.equal(tax.trusted, true);
assert.equal(tax.current, true);
assert.equal(tax.applicable, true);
assert.equal(evaluateTaxTrust({ ...taxBase, verificationStatus: "UNVERIFIED", verificationSource: "LOCAL", verificationAssurance: "LOCAL_CHECKS_ONLY" }, taxContext, evidence).applicable, false);
assert.equal(evaluateTaxTrust({ ...taxBase, sellerId: "seller-b" }, taxContext, evidence).applicable, false);
assert.equal(evaluateTaxTrust({ ...taxBase, onboardingVersion: 3 }, taxContext, evidence).applicable, false);
assert.equal(evaluateTaxTrust({ ...taxBase, normalizedFingerprint: "f".repeat(64) }, taxContext, evidence).applicable, false);
assert.equal(evaluateTaxTrust(taxBase, taxContext, { ...evidence, evidencePresent: false }).applicable, false);
assert.equal(evaluateTaxTrust(taxBase, taxContext, { ...evidence, sourceAuthenticated: false }).applicable, false);
const trustedBelowPolicy = evaluateTaxTrust(taxBase, taxContext, evidence, "PROVIDER_VERIFIED");
assert.equal(trustedBelowPolicy.trusted, true);
assert.equal(trustedBelowPolicy.applicable, false);

const bankContext = buildBankDestinationContext({ financialIdentityId: "identity-a", iban: "TR330006100519786457841326", beneficiaryName: "Synthetic A.Ş." });
const bankRevision = { id: "revision-2", financialIdentityId: "identity-a", destinationVersion: 2, canonicalIban: bankContext.canonicalIban, beneficiaryName: bankContext.beneficiaryName, normalizedFingerprint: bankContext.normalizedFingerprint, verificationStatus: "VERIFIED" as const, verificationSource: "MANUAL" as const, verificationAssurance: "DOCUMENT_REVIEWED" as const };
const currentEvaluation = evaluateCurrentBankDestination({ id: "identity-a", currentBankDestinationRevisionId: "revision-2" }, bankRevision);
const bankInput = { expectedSellerId: "seller-a", observedSellerId: "seller-a", identity: { id: "identity-a", currentBankDestinationRevisionId: "revision-2" }, revision: bankRevision, currentEvaluation, evidence };
const bank = evaluateBankDestinationTrust(bankInput);
assert.equal(bank.trusted, true);
assert.equal(bank.current, true);
assert.equal(bank.applicable, true);
assert.equal(evaluateBankDestinationTrust({ ...bankInput, observedSellerId: "seller-b" }).applicable, false);
assert.equal(evaluateBankDestinationTrust({ ...bankInput, identity: { ...bankInput.identity, currentBankDestinationRevisionId: "revision-1" }, currentEvaluation: { current: false } }).current, false);
assert.equal(evaluateBankDestinationTrust({ ...bankInput, revision: { ...bankRevision, financialIdentityId: "identity-b" } }).applicable, false);
assert.equal(evaluateBankDestinationTrust({ ...bankInput, revision: { ...bankRevision, verificationAssurance: "LOCAL_CHECKS_ONLY" } }).applicable, false);
assert.equal(evaluateBankDestinationTrust({ ...bankInput, evidence: { ...evidence, evidencePresent: false } }).applicable, false);

const payoutBase = { onboardingStatus: "APPROVED" as const, activationEligible: true, sellerStatus: "APPROVED" as const, tax, bank, holdActive: false, payoutStatus: "AVAILABLE" as const, hasBlockingRefundOrDispute: false };
assert.equal(evaluatePayoutTrust(payoutBase).transferEligible, true);
assert.equal(evaluatePayoutTrust({ ...payoutBase, tax: trustedBelowPolicy }).applicable, false);
const held = evaluatePayoutTrust({ ...payoutBase, holdActive: true });
assert.equal(held.transferEligible, false);
assert.deepEqual(held.reasons, ["FINANCIAL_HOLD_ACTIVE"]);
assert.equal(evaluatePayoutTrust({ ...payoutBase, tax: evaluateTaxTrust({ ...taxBase, onboardingVersion: 3 }, taxContext, evidence) }).transferEligible, false);
assert.equal(evaluatePayoutTrust({ ...payoutBase, bank: evaluateBankDestinationTrust({ ...bankInput, identity: { ...bankInput.identity, currentBankDestinationRevisionId: "revision-1" }, currentEvaluation: { current: false } }) }).transferEligible, false);

for (const result of [tax, bank, trustedBelowPolicy, held]) {
  const serialized = JSON.stringify(result);
  assert(!serialized.includes(profile.taxNumber));
  assert(!serialized.includes(bankContext.canonicalIban));
  if ("reasonCodes" in result) for (const code of result.reasonCodes) assert.equal(isSafeReasonCode(code), true);
  if ("reasons" in result) for (const code of result.reasons) assert.equal(isSafeReasonCode(code), true);
}

console.log("PASS: #21 Slice B finance evaluator adoption preserves bindings, evidence, currentness, assurance ownership and payout policy");
