import assert from "node:assert/strict";
import { evaluateFinancialIdentityTrust, evaluatePayoutTransferEligibility, meetsFinancialAssurance } from "../app/lib/payout-eligibility-domain";

const eligible = { onboardingStatus: "APPROVED" as const, activationEligible: true, sellerStatus: "APPROVED" as const, taxTrusted: true, bankTrusted: true, holdActive: false, payoutStatus: "AVAILABLE" as const, hasBlockingRefundOrDispute: false };
assert.equal(evaluatePayoutTransferEligibility(eligible).transferEligible, true);
for (const mutation of [
  { onboardingStatus: "SUBMITTED" as const }, { activationEligible: false }, { sellerStatus: "SUSPENDED" as const }, { taxTrusted: false }, { bankTrusted: false }, { holdActive: true },
  { payoutStatus: "PENDING" as const }, { payoutStatus: "BLOCKED" as const }, { payoutStatus: "CANCELLED" as const }, { payoutStatus: "PAID" as const }, { payoutStatus: "SCHEDULED" as const }, { hasBlockingRefundOrDispute: true },
]) assert.equal(evaluatePayoutTransferEligibility({ ...eligible, ...mutation }).transferEligible, false);
assert.equal(evaluateFinancialIdentityTrust({ onboardingStatus: "APPROVED", activationEligible: true, taxTrusted: true, bankTrusted: true }).trusted, true);
assert.equal(evaluateFinancialIdentityTrust({ onboardingStatus: "APPROVED", activationEligible: true, taxTrusted: true, bankTrusted: false }).trusted, false);
assert.equal(meetsFinancialAssurance("LOCAL_CHECKS_ONLY"), false);
assert.equal(meetsFinancialAssurance("DOCUMENT_REVIEWED"), true);
assert.equal(meetsFinancialAssurance("PROVIDER_VERIFIED"), true);
assert.equal(meetsFinancialAssurance("AUTHORITY_VERIFIED"), true);
for (const reason of evaluatePayoutTransferEligibility({ ...eligible, taxTrusted: false, bankTrusted: false, holdActive: true }).reasons) assert.match(reason, /^[A-Z_]+$/);
console.log("PASS: #20 Slice F authoritative transfer eligibility, assurance and safe reason policy");
