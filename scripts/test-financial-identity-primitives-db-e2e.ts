import "server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";

const testEnv = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: testEnv.DATABASE_URL, SUPABASE_CA_CERT_PATH: testEnv.SUPABASE_CA_CERT_PATH });
const ids = { users: [] as string[], sellers: [] as string[], identities: [] as string[], banks: [] as string[], taxes: [] as string[], evidence: [] as string[] };
const key = () => randomUUID();

async function cleanup() {
  if (ids.evidence.length) await prisma.financialVerificationEvidence.deleteMany({ where: { id: { in: ids.evidence } } });
  if (ids.identities.length) await prisma.sellerFinancialIdentity.updateMany({ where: { id: { in: ids.identities } }, data: { currentBankDestinationRevisionId: null } });
  if (ids.taxes.length) await prisma.taxVerification.deleteMany({ where: { id: { in: ids.taxes } } });
  if (ids.banks.length) await prisma.bankDestinationRevision.deleteMany({ where: { id: { in: ids.banks } } });
  if (ids.identities.length) await prisma.sellerFinancialIdentity.deleteMany({ where: { id: { in: ids.identities } } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function createSeller(label: string, role: "SELLER" | "ADMIN" = "SELLER") {
  const token = key();
  const user = await prisma.user.create({
    data: {
      name: "FI", surname: label, email: `fi-${token}@invalid.local`, phone: "0", passwordHash: "qa", role,
      sellerProfile: { create: { storeName: `FI-${label}`, storeSlug: `fi-${token}`, companyType: "QA", taxNumber: token, taxOffice: "QA", city: "QA", address: "QA", description: "QA" } },
    }, include: { sellerProfile: true },
  });
  ids.users.push(user.id); ids.sellers.push(user.sellerProfile!.id);
  assert.equal(user.financialIdentityReviewerEnabled, false, "existing role unexpectedly grants financial reviewer capability");
  return user;
}

async function expectConstraint(action: () => Promise<unknown>, label: string) {
  await assert.rejects(action, (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2010", "P2039"].includes(error.code), label);
}

async function main() {
  await cleanup();
  try {
    const db = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() as database, current_user as role`;
    assert.equal(db[0]?.database, "postgres", "TEST database identity mismatch");
    assert.equal(db[0]?.role, "postgres", "TEST database role mismatch");

    const sellerA = await createSeller("A");
    const sellerB = await createSeller("B");
    const admin = await prisma.user.create({ data: { name: "FI", surname: "Admin", email: `fi-admin-${key()}@invalid.local`, phone: "0", passwordHash: "qa", role: "ADMIN" } });
    ids.users.push(admin.id);
    assert.equal(admin.financialIdentityReviewerEnabled, false, "ADMIN auto-granted financial reviewer capability");

    const identityA = await prisma.sellerFinancialIdentity.create({ data: { sellerId: sellerA.sellerProfile!.id } });
    const identityB = await prisma.sellerFinancialIdentity.create({ data: { sellerId: sellerB.sellerProfile!.id } });
    ids.identities.push(identityA.id, identityB.id);
    assert.equal(identityA.currentBankDestinationRevisionId, null, "partial shell unexpectedly has a bank destination");
    assert.equal(identityA.holdActive, true, "partial shell is not held by default");
    assert.equal(identityA.holdReasonCode, "FINANCIAL_IDENTITY_INCOMPLETE", "partial shell has unsafe hold reason");
    assert.equal(identityA.coordinationVersion, 0, "coordination version default changed");
    await expectConstraint(() => prisma.sellerFinancialIdentity.create({ data: { sellerId: sellerA.sellerProfile!.id } }), "seller financial identity uniqueness missing");

    const bankA1 = await prisma.bankDestinationRevision.create({ data: { financialIdentityId: identityA.id, destinationVersion: 1, canonicalIban: "TR000000000000000000000000", beneficiaryName: "Slice A fixture", normalizedFingerprint: "a".repeat(64) } });
    const bankA2 = await prisma.bankDestinationRevision.create({ data: { financialIdentityId: identityA.id, destinationVersion: 2, canonicalIban: "TR111111111111111111111111", beneficiaryName: "Slice A fixture", normalizedFingerprint: "b".repeat(64) } });
    const bankB1 = await prisma.bankDestinationRevision.create({ data: { financialIdentityId: identityB.id, destinationVersion: 1, canonicalIban: "TR222222222222222222222222", beneficiaryName: "Slice B fixture", normalizedFingerprint: "c".repeat(64) } });
    ids.banks.push(bankA1.id, bankA2.id, bankB1.id);
    assert.equal(bankA1.verificationStatus, "UNVERIFIED");
    assert.equal(bankA1.verificationSource, "LOCAL");
    assert.equal(bankA1.verificationAssurance, "LOCAL_CHECKS_ONLY");
    await prisma.sellerFinancialIdentity.update({ where: { id: identityA.id }, data: { currentBankDestinationRevisionId: bankA2.id } });
    await expectConstraint(() => prisma.sellerFinancialIdentity.update({ where: { id: identityA.id }, data: { currentBankDestinationRevisionId: bankB1.id } }), "cross-aggregate current bank pointer accepted");
    await expectConstraint(() => prisma.bankDestinationRevision.create({ data: { financialIdentityId: identityA.id, destinationVersion: 2, canonicalIban: "TR333333333333333333333333", beneficiaryName: "Duplicate", normalizedFingerprint: "d".repeat(64) } }), "destination version uniqueness missing");

    const tax = await prisma.taxVerification.create({ data: { sellerId: sellerA.sellerProfile!.id, onboardingVersion: sellerA.sellerProfile!.onboardingVersion, identifierType: "VKN", normalizedFingerprint: "e".repeat(64), idempotencyKey: `tax-${key()}` } });
    ids.taxes.push(tax.id);
    assert.equal(tax.verificationStatus, "UNVERIFIED");
    assert.equal(tax.verificationSource, "LOCAL");
    assert.equal(tax.verificationAssurance, "LOCAL_CHECKS_ONLY");
    await expectConstraint(() => prisma.taxVerification.create({ data: { sellerId: sellerA.sellerProfile!.id, onboardingVersion: tax.onboardingVersion, identifierType: "VKN", normalizedFingerprint: tax.normalizedFingerprint, idempotencyKey: `tax-${key()}` } }), "tax profile-version-fingerprint binding uniqueness missing");

    const evidence = await prisma.financialVerificationEvidence.create({ data: { sellerId: sellerA.sellerProfile!.id, taxVerificationId: tax.id, verificationSource: "LOCAL", verificationAssurance: "LOCAL_CHECKS_ONLY", normalizedFingerprint: tax.normalizedFingerprint, identityVersion: tax.onboardingVersion, requestIdempotencyKey: `evidence-${key()}` } });
    ids.evidence.push(evidence.id);
    await expectConstraint(() => prisma.financialVerificationEvidence.create({ data: { sellerId: sellerA.sellerProfile!.id, verificationSource: "LOCAL", verificationAssurance: "LOCAL_CHECKS_ONLY", normalizedFingerprint: "f".repeat(64), identityVersion: 0, requestIdempotencyKey: `evidence-${key()}` } }), "evidence without exact verification context accepted");
    await expectConstraint(() => prisma.financialVerificationEvidence.create({ data: { sellerId: sellerB.sellerProfile!.id, taxVerificationId: tax.id, verificationSource: "LOCAL", verificationAssurance: "LOCAL_CHECKS_ONLY", normalizedFingerprint: tax.normalizedFingerprint, identityVersion: tax.onboardingVersion, requestIdempotencyKey: `evidence-${key()}` } }), "cross-seller tax evidence accepted");
    await expectConstraint(() => prisma.financialVerificationEvidence.create({ data: { sellerId: sellerB.sellerProfile!.id, financialIdentityId: identityA.id, bankDestinationRevisionId: bankA1.id, verificationSource: "LOCAL", verificationAssurance: "LOCAL_CHECKS_ONLY", normalizedFingerprint: bankA1.normalizedFingerprint, identityVersion: bankA1.destinationVersion, requestIdempotencyKey: `evidence-${key()}` } }), "cross-seller bank evidence accepted");
    await expectConstraint(() => prisma.taxVerification.delete({ where: { id: tax.id } }), "evidence did not preserve referenced verification history");

    const payouts = await prisma.sellerPayout.count({ where: { sellerId: sellerA.sellerProfile!.id } });
    const ledger = await prisma.financialLedgerEntry.count({ where: { sellerId: sellerA.sellerProfile!.id } });
    assert.equal(payouts, 0, "Slice A created payout state");
    assert.equal(ledger, 0, "Slice A created ledger state");
    console.log("PASS: #20 Slice A TEST DB defaults, uniqueness, revision ownership, tax binding, evidence integrity and reviewer safety");
  } finally {
    await cleanup();
    const leftovers = await Promise.all([
      prisma.financialVerificationEvidence.count({ where: { id: { in: ids.evidence } } }),
      prisma.taxVerification.count({ where: { id: { in: ids.taxes } } }),
      prisma.bankDestinationRevision.count({ where: { id: { in: ids.banks } } }),
      prisma.sellerFinancialIdentity.count({ where: { id: { in: ids.identities } } }),
    ]);
    assert(leftovers.every((count) => count === 0), "Slice A exact-ID cleanup failed");
    await prisma.$disconnect();
  }
}

void main();
