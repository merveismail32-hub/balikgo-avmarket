import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { CommissionAgreementError, createSellerCategoryCommissionAgreement, getEffectiveSellerCategoryCommissionAgreement, updateSellerCategoryCommissionAgreement } from "../app/lib/seller-category-commission-agreement";
import { CommissionPolicyResolutionError, CommissionPolicySelectionError, resolveCommissionPolicy } from "../app/lib/commission-policy";

const testEnv = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: testEnv.DATABASE_URL, SUPABASE_CA_CERT_PATH: testEnv.SUPABASE_CA_CERT_PATH });
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const ids = { users: [] as string[], sellers: [] as string[], categories: [] as string[], agreements: [] as string[] };
const at = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function seller(label: string) {
  const user = await prisma.user.create({ data: { name: "QA", surname: label, email: `commission-${label}-${suffix}@invalid.local`, phone: "000", passwordHash: "not-used", role: "SELLER", sellerProfile: { create: { storeName: `Commission ${label}`, storeSlug: `commission-${label}-${suffix}`, companyType: "TEST", taxNumber: `QA-${label}-${suffix}`, taxOffice: "Test", city: "Test", address: "QA only", description: "QA only", status: "APPROVED" } } }, include: { sellerProfile: true } });
  ids.users.push(user.id); ids.sellers.push(user.sellerProfile!.id); return user.sellerProfile!;
}

async function expectCode(operation: () => Promise<unknown>, code: CommissionAgreementError["code"]) {
  await assert.rejects(operation, (error) => error instanceof CommissionAgreementError && error.code === code, `Expected ${code}`);
}

async function main() {
  const admin = await prisma.user.create({ data: { name: "QA", surname: "Admin", email: `commission-admin-${suffix}@invalid.local`, phone: "000", passwordHash: "not-used", role: "ADMIN" } }); ids.users.push(admin.id);
  const sellerA = await seller("a"), sellerB = await seller("b");
  const categoryA = await prisma.category.create({ data: { name: `Commission A ${suffix}`, slug: `commission-a-${suffix}` } });
  const categoryB = await prisma.category.create({ data: { name: `Commission B ${suffix}`, slug: `commission-b-${suffix}`, parentId: categoryA.id } });
  ids.categories.push(categoryA.id, categoryB.id);
  const command = { actorUserId: admin.id, sellerId: sellerA.id, categoryId: categoryA.id, commissionRate: "0.0750", effectiveFrom: at("2026-01-01"), effectiveUntil: at("2026-02-01"), reason: "QA initial agreement" };

  const first = await createSellerCategoryCommissionAgreement(command, prisma); ids.agreements.push(first.agreementId);
  assert.equal(first.source, "SELLER_CATEGORY_AGREEMENT"); assert.equal(first.agreementVersion, 1); assert.equal(first.rate.toString(), "0.075");
  await expectCode(() => createSellerCategoryCommissionAgreement({ ...command, actorUserId: sellerA.userId, reason: "QA unauthorized create" }, prisma), "FORBIDDEN");
  const adjacent = await createSellerCategoryCommissionAgreement({ ...command, commissionRate: "0.08", effectiveFrom: at("2026-02-01"), effectiveUntil: at("2026-03-01"), reason: "QA adjacent agreement" }, prisma); ids.agreements.push(adjacent.agreementId);
  await expectCode(() => createSellerCategoryCommissionAgreement({ ...command, effectiveFrom: at("2026-01-15"), effectiveUntil: at("2026-02-15"), reason: "QA overlap" }, prisma), "OVERLAPPING_AGREEMENT");

  const otherSeller = await createSellerCategoryCommissionAgreement({ ...command, sellerId: sellerB.id, reason: "QA other seller" }, prisma); ids.agreements.push(otherSeller.agreementId);
  const otherCategory = await createSellerCategoryCommissionAgreement({ ...command, categoryId: categoryB.id, reason: "QA other category" }, prisma); ids.agreements.push(otherCategory.agreementId);

  const read = await getEffectiveSellerCategoryCommissionAgreement({ sellerId: sellerA.id, categoryId: categoryA.id, at: at("2026-01-15") }, prisma);
  assert.equal(read?.agreementId, first.agreementId); assert.equal(read?.agreementVersion, 1);
  const before = await resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryA.id, effectiveAt: at("2025-12-31") }, { configuredRate: "0.11", client: prisma });
  assert.equal(before.source, "GLOBAL_CONFIG");
  const atStart = await resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryA.id, effectiveAt: at("2026-01-01") }, { configuredRate: "0.11", client: prisma });
  assert.equal(atStart.source, "SELLER_CATEGORY_AGREEMENT"); assert.equal(atStart.agreementId, first.agreementId); assert.equal(atStart.agreementVersion, 1);
  const beforeEnd = await resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryA.id, effectiveAt: new Date("2026-01-31T23:59:59.999Z") }, { configuredRate: "0.11", client: prisma });
  assert.equal(beforeEnd.source, "SELLER_CATEGORY_AGREEMENT"); assert.equal(beforeEnd.agreementId, first.agreementId);
  const atEnd = await resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryA.id, effectiveAt: at("2026-02-01") }, { configuredRate: "0.11", client: prisma });
  assert.equal(atEnd.source, "SELLER_CATEGORY_AGREEMENT"); assert.equal(atEnd.agreementId, adjacent.agreementId);
  const wrongSeller = await resolveCommissionPolicy({ sellerId: sellerB.id, categoryId: categoryA.id, effectiveAt: at("2025-12-31") }, { configuredRate: undefined, client: prisma });
  assert.equal(wrongSeller.source, "DEFAULT_FALLBACK");
  const wrongCategory = await resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryB.id, effectiveAt: at("2025-12-31") }, { configuredRate: undefined, client: prisma });
  assert.equal(wrongCategory.source, "DEFAULT_FALLBACK");
  await assert.rejects(
    () => resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryA.id, effectiveAt: at("2025-12-31") }, { configuredRate: "bad", client: prisma }),
    (error) => error instanceof CommissionPolicySelectionError && error.code === "INVALID_COMMISSION_RATE",
  );

  const openEnded = await createSellerCategoryCommissionAgreement({ ...command, categoryId: categoryB.id, commissionRate: "0.09", effectiveFrom: at("2026-02-01"), effectiveUntil: null, reason: "QA open ended agreement" }, prisma); ids.agreements.push(openEnded.agreementId);
  const openEndedRead = await resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryB.id, effectiveAt: at("2027-01-01") }, { configuredRate: "0.11", client: prisma });
  assert.equal(openEndedRead.source, "SELLER_CATEGORY_AGREEMENT"); assert.equal(openEndedRead.agreementId, openEnded.agreementId);

  const ambiguous = await prisma.sellerCategoryCommissionAgreement.create({ data: { sellerId: sellerA.id, categoryId: categoryB.id, commissionRate: "0.095", effectiveFrom: at("2026-01-15"), effectiveUntil: at("2026-03-01") } }); ids.agreements.push(ambiguous.id);
  await assert.rejects(
    () => resolveCommissionPolicy({ sellerId: sellerA.id, categoryId: categoryB.id, effectiveAt: at("2026-02-15") }, { configuredRate: "0.11", client: prisma }),
    (error) => error instanceof CommissionPolicyResolutionError && error.code === "AMBIGUOUS_COMMISSION_POLICY",
  );
  await prisma.sellerCategoryCommissionAgreement.delete({ where: { id: ambiguous.id } }); ids.agreements.splice(ids.agreements.indexOf(ambiguous.id), 1);

  await expectCode(() => updateSellerCategoryCommissionAgreement({ ...command, sellerId: sellerB.id, agreementId: first.agreementId, expectedVersion: 1, reason: "QA cross-seller update" }, prisma), "AGREEMENT_NOT_FOUND");
  const updated = await updateSellerCategoryCommissionAgreement({ ...command, agreementId: first.agreementId, expectedVersion: 1, commissionRate: "0.0760", reason: "QA version two" }, prisma);
  assert.equal(updated.agreementId, first.agreementId); assert.equal(updated.agreementVersion, 2); assert.equal(updated.rate.toString(), "0.076");
  await expectCode(() => updateSellerCategoryCommissionAgreement({ ...command, agreementId: first.agreementId, expectedVersion: 1, reason: "QA stale update" }, prisma), "STALE_VERSION");

  const raced = await Promise.allSettled(["0.0770", "0.0780"].map((commissionRate) => updateSellerCategoryCommissionAgreement({ ...command, agreementId: first.agreementId, expectedVersion: 2, commissionRate, reason: "QA concurrent update" }, prisma)));
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(raced.filter((result) => result.status === "rejected" && result.reason instanceof CommissionAgreementError && ["STALE_VERSION", "CONCURRENT_CHANGE"].includes(result.reason.code)).length, 1);
  const final = await prisma.sellerCategoryCommissionAgreement.findUniqueOrThrow({ where: { id: first.agreementId } }); assert.equal(final.version, 3);
  assert.equal(await prisma.adminAuditLog.count({ where: { entityType: "COMMISSION_AGREEMENT", entityId: { in: ids.agreements } } }), 7);
  console.log("PASS: #22 Slice B/C TEST DB mutation invariants, exact temporal resolution, precedence, isolation, ambiguity and concurrent CAS");
}

async function cleanup() {
  if (ids.agreements.length) await prisma.adminAuditLog.deleteMany({ where: { entityType: "COMMISSION_AGREEMENT", entityId: { in: ids.agreements } } });
  if (ids.agreements.length) await prisma.sellerCategoryCommissionAgreement.deleteMany({ where: { id: { in: ids.agreements } } });
  for (const categoryId of ids.categories.toReversed()) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

main().finally(async () => { await cleanup(); await prisma.$disconnect(); }).catch((error) => { console.error("FAIL:", error instanceof Error ? error.message : error); process.exitCode = 1; });
