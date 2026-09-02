import assert from "node:assert/strict";
import { assertFinancialReviewTransition, canReviewFinancialIdentity, FinancialReviewError, manualDecisionMarker, validateManualReviewIntent } from "../app/lib/financial-review-domain";

assert.equal(canReviewFinancialIdentity({ role: "ADMIN", financialIdentityReviewerEnabled: false }), false);
assert.equal(canReviewFinancialIdentity({ role: "SELLER", financialIdentityReviewerEnabled: true }), false);
assert.equal(canReviewFinancialIdentity({ role: "ADMIN", financialIdentityReviewerEnabled: true }), true);
assert.equal(assertFinancialReviewTransition("UNVERIFIED", "APPROVE"), "VERIFIED");
assert.equal(assertFinancialReviewTransition("PENDING", "REJECT"), "REJECTED");
assert.equal(assertFinancialReviewTransition("NEEDS_REVIEW", "APPROVE"), "VERIFIED");
assert.throws(() => assertFinancialReviewTransition("VERIFIED", "APPROVE"), (error) => error instanceof FinancialReviewError && error.code === "INVALID_STATE");
assert.throws(() => validateManualReviewIntent({ decision: "APPROVE", reasonCode: "OK", evidenceReference: "", idempotencyKey: "key" }), (error) => error instanceof FinancialReviewError && error.code === "INVALID_INPUT");
const intent = validateManualReviewIntent({ decision: "APPROVE", reasonCode: "DOCUMENTS_MATCH", evidenceReference: "vault://review/evidence-1", idempotencyKey: "review-1" });
assert.equal(manualDecisionMarker(intent.decision, intent.reasonCode), "MANUAL_APPROVE:DOCUMENTS_MATCH");
assert(!("verificationSource" in intent) && !("verificationAssurance" in intent) && !("reviewerUserId" in intent));
console.log("PASS: #20 Slice E reviewer capability, transition and server-controlled manual intent boundaries");
