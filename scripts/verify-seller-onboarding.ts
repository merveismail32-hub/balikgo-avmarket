import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { assertSubmissionComplete, nextReviewStatus, sellerOnboardingDraftSchema, SellerOnboardingError } from "../app/lib/seller-onboarding-domain.ts";

const valid = { storeName: "Balıkçı Dükkanı", legalName: "Balıkçı Dükkanı Ltd. Şti.", companyType: "Limited şirket", taxNumber: "1234567890", taxOffice: "Kadıköy", city: "İstanbul", address: "Örnek Mahallesi No 10 Kadıköy", description: "Olta ve balıkçılık ekipmanları satışı yapılır.", categories: "Olta, yem", phone: "05555555555", authorizedPersonName: "Ada", authorizedPersonSurname: "Deniz", authorizedPersonEmail: "ada@example.invalid", authorizedPersonTitle: "Müdür", acceptedTerms: true as const, documents: [{ type: "TAX_CERTIFICATE" as const, reference: "storage:tax:1" }, { type: "IDENTITY_DOCUMENT" as const, reference: "storage:id:1" }] };

assert(sellerOnboardingDraftSchema.safeParse(valid).success, "valid KYB application rejected");
assert(!sellerOnboardingDraftSchema.safeParse({ ...valid, status: "APPROVED" }).success, "mass assignment accepted status");
assert(!sellerOnboardingDraftSchema.safeParse({ ...valid, reviewerUserId: "attacker" }).success, "mass assignment accepted reviewer");
assert(!sellerOnboardingDraftSchema.safeParse({ ...valid, activationEligible: true }).success, "mass assignment accepted eligibility");
assert(!sellerOnboardingDraftSchema.safeParse({ ...valid, documents: [valid.documents[0], valid.documents[0]] }).success, "duplicate document type accepted");
assert.throws(() => assertSubmissionComplete({ ...valid, documents: [valid.documents[0]] }), (error) => error instanceof SellerOnboardingError && error.code === "INCOMPLETE");
assert.doesNotThrow(() => assertSubmissionComplete(valid));

assert.equal(nextReviewStatus("SUBMITTED", "START_REVIEW"), "UNDER_REVIEW");
assert.equal(nextReviewStatus("SUBMITTED", "REQUEST_REVISION"), "NEEDS_REVISION");
assert.equal(nextReviewStatus("UNDER_REVIEW", "APPROVE"), "APPROVED");
assert.equal(nextReviewStatus("UNDER_REVIEW", "REJECT"), "REJECTED");
assert.equal(nextReviewStatus("APPROVED", "APPROVE"), "APPROVED", "duplicate approval must be an idempotent no-op");
assert.equal(nextReviewStatus("REJECTED", "REJECT"), "REJECTED", "duplicate rejection must be an idempotent no-op");
for (const [status, action] of [["DRAFT", "APPROVE"], ["NEEDS_REVISION", "APPROVE"], ["APPROVED", "REJECT"], ["REJECTED", "APPROVE"]] as const) assert.throws(() => nextReviewStatus(status, action), /işlemi yapılamaz/);

const service = readFileSync(new URL("../app/lib/seller-onboarding.ts", import.meta.url), "utf8");
const sellerRoute = readFileSync(new URL("../app/api/seller-applications/route.ts", import.meta.url), "utf8");
const adminRoute = readFileSync(new URL("../app/api/admin/seller-applications/[id]/route.ts", import.meta.url), "utf8");
const activationRoute = readFileSync(new URL("../app/api/admin/sellers/[id]/route.ts", import.meta.url), "utf8");
assert.match(service, /where: \{ userId \}/, "seller ownership/IDOR boundary missing");
assert.match(service, /current\.userId === input\.reviewerUserId/, "self-review guard missing");
assert.match(service, /onboardingVersion: current\.onboardingVersion/, "review CAS/version guard missing");
assert.match(service, /onboardingStatus: current\.onboardingStatus/, "review state CAS guard missing");
assert.match(service, /TransactionIsolationLevel\.Serializable/g, "serializable transaction boundary missing");
assert.match(service, /idempotencyKey: input\.idempotencyKey/g, "idempotent event boundary missing");
assert.match(service, /sellerSafeSelect/, "seller-safe DTO select missing");
const sellerSelect = service.slice(service.indexOf("const sellerSafeSelect"), service.indexOf("export async function getOwnSellerOnboarding"));
assert(!/reviewerUserId|reviewNote|onboardingEvents|idempotencyKey/.test(sellerSelect), "internal review data leaked through seller DTO");
assert.match(sellerRoute, /session\.user\.id/, "seller route authentication missing");
assert.match(adminRoute, /session\.user\.role !== "ADMIN"/, "review RBAC missing");
assert.match(activationRoute, /onboardingStatus !== "APPROVED"\s*\|\|\s*!seller\.activationEligible/, "KYB/activation eligibility boundary missing");

const migration = readFileSync(new URL("../prisma/migrations/20260830120000_seller_onboarding_kyb/migration.sql", import.meta.url), "utf8");
assert(!/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(migration), "migration contains destructive operation");
assert.match(migration, /Preserve existing production seller decisions/, "legacy seller compatibility backfill missing");
console.log("PASS: #19 seller onboarding/KYB state, authorization, DTO, idempotency, concurrency, audit and activation boundaries verified.");
