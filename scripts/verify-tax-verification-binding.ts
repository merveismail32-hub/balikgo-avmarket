import "server-only";
import assert from "node:assert/strict";
import { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability, TaxVerificationError } from "../app/lib/tax-verification-domain";

const profile = { id: "seller-a", onboardingVersion: 7, taxNumber: "10000000146", legalName: "Balık Go A.Ş.", companyType: "Anonim Şirket", taxOffice: "Kadıköy" };
const context = buildCurrentTaxVerificationContext(profile, "TCKN");
assert.equal(context.sellerId, profile.id);
assert.equal(context.onboardingVersion, 7);
assert.equal(context.localValidation.locallyValid, true);

const local = { ...context, verificationStatus: "UNVERIFIED" as const, verificationAssurance: "LOCAL_CHECKS_ONLY" as const };
assert.deepEqual(evaluateTaxVerificationApplicability(local, context), { exactContext: true, workflowVerified: false, assuranceSufficient: false, applicable: false });
const trusted = { ...context, verificationStatus: "VERIFIED" as const, verificationAssurance: "DOCUMENT_REVIEWED" as const };
assert.equal(evaluateTaxVerificationApplicability(trusted, context).applicable, true);
assert.equal(evaluateTaxVerificationApplicability({ ...trusted, sellerId: "seller-b" }, context).applicable, false);
assert.equal(evaluateTaxVerificationApplicability({ ...trusted, onboardingVersion: 8 }, context).applicable, false);
assert.equal(evaluateTaxVerificationApplicability({ ...trusted, identifierType: "VKN" }, context).applicable, false);
assert.equal(evaluateTaxVerificationApplicability({ ...trusted, normalizedFingerprint: "f".repeat(64) }, context).applicable, false);

const changedTax = buildCurrentTaxVerificationContext({ ...profile, taxNumber: "10000000214" }, "TCKN");
assert.notEqual(changedTax.normalizedFingerprint, context.normalizedFingerprint);
const changedLegalName = buildCurrentTaxVerificationContext({ ...profile, legalName: "Başka Ünvan" }, "TCKN");
assert.notEqual(changedLegalName.normalizedFingerprint, context.normalizedFingerprint);
const changedCompanyType = buildCurrentTaxVerificationContext({ ...profile, companyType: "Şahıs İşletmesi" }, "TCKN");
assert.notEqual(changedCompanyType.normalizedFingerprint, context.normalizedFingerprint);
const changedTaxOffice = buildCurrentTaxVerificationContext({ ...profile, taxOffice: "Beşiktaş" }, "TCKN");
assert.notEqual(changedTaxOffice.normalizedFingerprint, context.normalizedFingerprint);
assert.throws(() => buildCurrentTaxVerificationContext({ ...profile, taxNumber: "123" }, "TCKN"), (error) => error instanceof TaxVerificationError && error.code === "INVALID_LOCAL_IDENTITY");

console.log("PASS: #20 Slice C exact seller/version/type/fingerprint applicability and fail-closed assurance");
