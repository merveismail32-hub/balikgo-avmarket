import "server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { recordCurrentTaxLocalValidation } from "../app/lib/tax-verification";
import { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability, TaxVerificationError } from "../app/lib/tax-verification-domain";

const testEnv = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: testEnv.DATABASE_URL, SUPABASE_CA_CERT_PATH: testEnv.SUPABASE_CA_CERT_PATH });
const ids = { users: [] as string[], sellers: [] as string[], taxes: [] as string[], evidence: [] as string[] };
const key = () => randomUUID();

async function createSeller(label: string, taxNumber = "10000000146") {
  const token = key();
  const user = await prisma.user.create({
    data: {
      name: "Slice", surname: label, email: `slice-c-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER",
      sellerProfile: { create: { storeName: `Slice-C-${label}`, storeSlug: `slice-c-${token}`, legalName: `Slice C ${label} A.Ş.`, companyType: "Anonim Şirket", taxNumber, taxOffice: "Kadıköy", city: "QA", address: "QA", description: "QA" } },
    },
    include: { sellerProfile: true },
  });
  ids.users.push(user.id);
  ids.sellers.push(user.sellerProfile!.id);
  return user.sellerProfile!;
}

async function cleanup() {
  if (ids.evidence.length) await prisma.financialVerificationEvidence.deleteMany({ where: { id: { in: ids.evidence } } });
  if (ids.taxes.length) await prisma.taxVerification.deleteMany({ where: { id: { in: ids.taxes } } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function main() {
  await cleanup();
  try {
    const sellerA = await createSeller("A");
    const sellerB = await createSeller("B");
    const requestKey = `slice-c-${key()}`;
    const input = { sellerId: sellerA.id, expectedOnboardingVersion: sellerA.onboardingVersion, identifierType: "TCKN" as const, idempotencyKey: requestKey };
    const created = await recordCurrentTaxLocalValidation(input, prisma);
    ids.taxes.push(created.id);
    assert.equal(created.verificationStatus, "UNVERIFIED");
    assert.equal(created.verificationSource, "LOCAL");
    assert.equal(created.verificationAssurance, "LOCAL_CHECKS_ONLY");
    assert.equal(created.reviewerUserId, null);
    assert.equal(created.decidedAt, null);

    const evidence = await prisma.financialVerificationEvidence.findUniqueOrThrow({ where: { requestIdempotencyKey: `${requestKey}:evidence` } });
    ids.evidence.push(evidence.id);
    assert.equal(evidence.sellerId, sellerA.id);
    assert.equal(evidence.taxVerificationId, created.id);
    assert.equal(evidence.identityVersion, created.onboardingVersion);
    assert.equal(evidence.normalizedFingerprint, created.normalizedFingerprint);
    assert.equal(evidence.verificationAssurance, "LOCAL_CHECKS_ONLY");

    const replay = await recordCurrentTaxLocalValidation(input, prisma);
    assert.equal(replay.id, created.id, "exact replay created a duplicate verification");
    assert.equal(await prisma.taxVerification.count({ where: { sellerId: sellerA.id } }), 1);
    assert.equal(await prisma.financialVerificationEvidence.count({ where: { taxVerificationId: created.id } }), 1);

    const secondKey = await recordCurrentTaxLocalValidation({ ...input, idempotencyKey: `slice-c-${key()}` }, prisma);
    assert.equal(secondKey.id, created.id, "same logical context did not converge to the existing record");
    await assert.rejects(
      recordCurrentTaxLocalValidation({ ...input, sellerId: sellerB.id }, prisma),
      (error: unknown) => error instanceof TaxVerificationError && error.code === "IDEMPOTENCY_CONFLICT",
    );

    await prisma.sellerProfile.update({ where: { id: sellerA.id }, data: { taxNumber: "10000000214" } });
    const changedProfile = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerA.id }, select: { id: true, onboardingVersion: true, taxNumber: true, legalName: true, companyType: true, taxOffice: true } });
    const changedContext = buildCurrentTaxVerificationContext(changedProfile, "TCKN");
    assert.equal(evaluateTaxVerificationApplicability(created, changedContext).exactContext, false, "same-version tax mutation left old evidence current");

    const sellerRace = await createSeller("Race");
    const raceKey = `slice-c-race-${key()}`;
    const [recordResult, updateResult] = await Promise.allSettled([
      recordCurrentTaxLocalValidation({ sellerId: sellerRace.id, expectedOnboardingVersion: sellerRace.onboardingVersion, identifierType: "TCKN", idempotencyKey: raceKey }, prisma),
      prisma.sellerProfile.updateMany({ where: { id: sellerRace.id, onboardingVersion: sellerRace.onboardingVersion }, data: { onboardingVersion: { increment: 1 }, legalName: "Slice C Race Changed A.Ş." } }),
    ]);
    assert.equal(updateResult.status, "fulfilled", "concurrent profile update failed unexpectedly");
    if (recordResult.status === "fulfilled") ids.taxes.push(recordResult.value.id);
    else assert(recordResult.reason instanceof TaxVerificationError && recordResult.reason.code === "STALE_CONTEXT", `unexpected race failure: ${String(recordResult.reason)}`);
    const currentRaceProfile = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerRace.id }, select: { id: true, onboardingVersion: true, taxNumber: true, legalName: true, companyType: true, taxOffice: true } });
    assert.equal(currentRaceProfile.onboardingVersion, sellerRace.onboardingVersion + 1);
    const currentRaceContext = buildCurrentTaxVerificationContext(currentRaceProfile, "TCKN");
    const historicalRace = await prisma.taxVerification.findMany({ where: { sellerId: sellerRace.id } });
    for (const verification of historicalRace) {
      assert.equal(evaluateTaxVerificationApplicability(verification, currentRaceContext).applicable, false, "racing historical verification became applicable");
      assert.equal(verification.verificationAssurance, "LOCAL_CHECKS_ONLY");
      assert.equal(verification.verificationStatus, "UNVERIFIED");
      const rows = await prisma.financialVerificationEvidence.findMany({ where: { taxVerificationId: verification.id } });
      ids.evidence.push(...rows.map((row) => row.id));
    }

    const invalidSeller = await createSeller("Invalid", "123");
    await assert.rejects(
      recordCurrentTaxLocalValidation({ sellerId: invalidSeller.id, expectedOnboardingVersion: invalidSeller.onboardingVersion, identifierType: "TCKN", idempotencyKey: `slice-c-${key()}` }, prisma),
      (error: unknown) => error instanceof TaxVerificationError && error.code === "INVALID_LOCAL_IDENTITY",
    );
    assert.equal(await prisma.taxVerification.count({ where: { sellerId: invalidSeller.id } }), 0);
    assert.equal(await prisma.sellerPayout.count({ where: { sellerId: { in: ids.sellers } } }), 0, "Slice C changed payout state");
    assert.equal(await prisma.financialLedgerEntry.count({ where: { sellerId: { in: ids.sellers } } }), 0, "Slice C changed ledger state");
    assert.equal(await prisma.sellerFinancialIdentity.count({ where: { sellerId: { in: ids.sellers } } }), 0, "Slice C created financial eligibility state");

    console.log("PASS: #20 Slice C TEST DB CAS, stale binding, replay, isolation and fail-closed local persistence");
  } finally {
    await cleanup();
    const leftovers = await Promise.all([
      prisma.financialVerificationEvidence.count({ where: { sellerId: { in: ids.sellers } } }),
      prisma.taxVerification.count({ where: { sellerId: { in: ids.sellers } } }),
    ]);
    assert(leftovers.every((count) => count === 0), "Slice C exact-seller cleanup failed");
    await prisma.$disconnect();
  }
}

void main();
