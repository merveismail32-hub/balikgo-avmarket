import "server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { setCurrentBankDestination } from "../app/lib/bank-destination";
import { BankDestinationError, evaluateCurrentBankDestination } from "../app/lib/bank-destination-domain";

const testEnv = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: testEnv.DATABASE_URL, SUPABASE_CA_CERT_PATH: testEnv.SUPABASE_CA_CERT_PATH });
const ids = { users: [] as string[], sellers: [] as string[], identities: [] as string[], revisions: [] as string[], evidence: [] as string[] };
const key = () => randomUUID();
const ibanA = "TR470000100100000350930001";
const ibanB = "TR330006100519786457841326";

async function createSeller(label: string) {
  const token = key();
  const user = await prisma.user.create({
    data: {
      name: "Slice", surname: label, email: `slice-d-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER",
      sellerProfile: { create: { storeName: `Slice-D-${label}`, storeSlug: `slice-d-${token}`, legalName: `Slice D ${label} A.Ş.`, companyType: "Anonim Şirket", taxNumber: "10000000146", taxOffice: "Kadıköy", city: "QA", address: "QA", description: "QA" } },
    }, include: { sellerProfile: true },
  });
  ids.users.push(user.id); ids.sellers.push(user.sellerProfile!.id);
  return user.sellerProfile!;
}

async function collect() {
  if (!ids.sellers.length) return;
  const identities = await prisma.sellerFinancialIdentity.findMany({ where: { sellerId: { in: ids.sellers } }, select: { id: true } });
  ids.identities.push(...identities.map(({ id }) => id).filter((id) => !ids.identities.includes(id)));
  const revisions = await prisma.bankDestinationRevision.findMany({ where: { financialIdentityId: { in: ids.identities } }, select: { id: true } });
  ids.revisions.push(...revisions.map(({ id }) => id).filter((id) => !ids.revisions.includes(id)));
  const evidence = await prisma.financialVerificationEvidence.findMany({ where: { sellerId: { in: ids.sellers } }, select: { id: true } });
  ids.evidence.push(...evidence.map(({ id }) => id).filter((id) => !ids.evidence.includes(id)));
}

async function cleanup() {
  await collect();
  if (ids.evidence.length) await prisma.financialVerificationEvidence.deleteMany({ where: { id: { in: ids.evidence } } });
  if (ids.identities.length) await prisma.sellerFinancialIdentity.updateMany({ where: { id: { in: ids.identities } }, data: { currentBankDestinationRevisionId: null } });
  if (ids.revisions.length) await prisma.bankDestinationRevision.deleteMany({ where: { id: { in: ids.revisions } } });
  if (ids.identities.length) await prisma.sellerFinancialIdentity.deleteMany({ where: { id: { in: ids.identities } } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function main() {
  await cleanup();
  try {
    const sellerA = await createSeller("A");
    const sellerB = await createSeller("B");
    const invalidKey = `slice-d-invalid-${key()}`;
    await assert.rejects(
      setCurrentBankDestination({ sellerId: sellerA.id, iban: "TR00", beneficiaryName: "Slice D A", expectedCoordinationVersion: 0, idempotencyKey: invalidKey }, prisma),
      (error: unknown) => error instanceof BankDestinationError && error.code === "INVALID_LOCAL_DESTINATION",
    );
    assert.equal(await prisma.sellerFinancialIdentity.count({ where: { sellerId: sellerA.id } }), 0, "invalid IBAN created an identity shell");

    const firstKey = `slice-d-first-${key()}`;
    const first = await setCurrentBankDestination({ sellerId: sellerA.id, iban: ibanA, beneficiaryName: "Slice D A A.Ş.", expectedCoordinationVersion: 0, idempotencyKey: firstKey }, prisma);
    ids.identities.push(first.identity.id); ids.revisions.push(first.revision.id);
    assert.equal(first.revision.destinationVersion, 1);
    assert.equal(first.revision.canonicalIban, ibanA);
    assert.equal(first.revision.verificationStatus, "UNVERIFIED");
    assert.equal(first.revision.verificationSource, "LOCAL");
    assert.equal(first.revision.verificationAssurance, "LOCAL_CHECKS_ONLY");
    assert.equal(first.identity.currentBankDestinationRevisionId, first.revision.id);
    assert.equal(first.identity.coordinationVersion, 1);
    assert.equal(first.identity.holdActive, true);
    assert.equal(first.identity.holdReasonCode, "BANK_VERIFICATION_REQUIRED");
    assert(!first.identity.holdReasonCode.includes(ibanA));
    assert.equal(evaluateCurrentBankDestination(first.identity, first.revision).current, true);

    const replay = await setCurrentBankDestination({ sellerId: sellerA.id, iban: ibanA, beneficiaryName: "Slice D A A.Ş.", expectedCoordinationVersion: 0, idempotencyKey: firstKey }, prisma);
    assert.equal(replay.revision.id, first.revision.id);
    assert.equal(replay.replay, true);
    const equivalent = await setCurrentBankDestination({ sellerId: sellerA.id, iban: ` ${ibanA} `, beneficiaryName: "  SLİCE   D A A.Ş. ", expectedCoordinationVersion: 1, idempotencyKey: `slice-d-equivalent-${key()}` }, prisma);
    assert.equal(equivalent.revision.id, first.revision.id);
    assert.equal(equivalent.changed, false);
    assert.equal(await prisma.bankDestinationRevision.count({ where: { financialIdentityId: first.identity.id } }), 1);
    await assert.rejects(
      setCurrentBankDestination({ sellerId: sellerA.id, iban: ibanB, beneficiaryName: "Attacker", expectedCoordinationVersion: 1, idempotencyKey: firstKey }, prisma),
      (error: unknown) => error instanceof BankDestinationError && error.code === "IDEMPOTENCY_CONFLICT",
    );

    await prisma.bankDestinationRevision.update({ where: { id: first.revision.id }, data: { verificationStatus: "VERIFIED", verificationSource: "MANUAL", verificationAssurance: "DOCUMENT_REVIEWED", decidedAt: new Date() } });
    const trustedEvidence = await prisma.financialVerificationEvidence.create({ data: { sellerId: sellerA.id, financialIdentityId: first.identity.id, bankDestinationRevisionId: first.revision.id, verificationSource: "MANUAL", verificationAssurance: "DOCUMENT_REVIEWED", normalizedFingerprint: first.revision.normalizedFingerprint, identityVersion: 1, reasonCode: "TEST_REVIEWED", requestIdempotencyKey: `slice-d-trusted-${key()}` } });
    ids.evidence.push(trustedEvidence.id);
    const changed = await setCurrentBankDestination({ sellerId: sellerA.id, iban: ibanB, beneficiaryName: "Slice D A A.Ş.", expectedCoordinationVersion: 1, idempotencyKey: `slice-d-change-${key()}` }, prisma);
    ids.revisions.push(changed.revision.id);
    assert.equal(changed.revision.destinationVersion, 2);
    assert.equal(changed.revision.verificationStatus, "UNVERIFIED");
    assert.equal(changed.revision.verificationAssurance, "LOCAL_CHECKS_ONLY");
    assert.notEqual(changed.revision.normalizedFingerprint, first.revision.normalizedFingerprint);
    const preserved = await prisma.bankDestinationRevision.findUniqueOrThrow({ where: { id: first.revision.id } });
    assert.equal(preserved.canonicalIban, ibanA);
    assert.equal(preserved.verificationStatus, "VERIFIED");
    assert.equal(await prisma.financialVerificationEvidence.count({ where: { id: trustedEvidence.id, bankDestinationRevisionId: changed.revision.id } }), 0);

    const beneficiaryChanged = await setCurrentBankDestination({ sellerId: sellerA.id, iban: ibanB, beneficiaryName: "Gerçek Başka Hesap Sahibi", expectedCoordinationVersion: 2, idempotencyKey: `slice-d-beneficiary-${key()}` }, prisma);
    ids.revisions.push(beneficiaryChanged.revision.id);
    assert.equal(beneficiaryChanged.revision.destinationVersion, 3);
    assert.notEqual(beneficiaryChanged.revision.normalizedFingerprint, changed.revision.normalizedFingerprint);
    await assert.rejects(
      setCurrentBankDestination({ sellerId: sellerA.id, iban: ibanA, beneficiaryName: "Stale", expectedCoordinationVersion: 2, idempotencyKey: `slice-d-stale-${key()}` }, prisma),
      (error: unknown) => error instanceof BankDestinationError && error.code === "STALE_CONTEXT",
    );

    const foreign = await setCurrentBankDestination({ sellerId: sellerB.id, iban: ibanA, beneficiaryName: "Slice D B", expectedCoordinationVersion: 0, idempotencyKey: `slice-d-b-${key()}` }, prisma);
    ids.identities.push(foreign.identity.id); ids.revisions.push(foreign.revision.id);
    await assert.rejects(
      prisma.sellerFinancialIdentity.update({ where: { id: first.identity.id }, data: { currentBankDestinationRevisionId: foreign.revision.id } }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2010", "P2039"].includes(error.code),
    );

    const sellerRace = await createSeller("Race");
    const raceFirst = await setCurrentBankDestination({ sellerId: sellerRace.id, iban: ibanA, beneficiaryName: "Race Original", expectedCoordinationVersion: 0, idempotencyKey: `slice-d-race-first-${key()}` }, prisma);
    ids.identities.push(raceFirst.identity.id); ids.revisions.push(raceFirst.revision.id);
    const raced = await Promise.allSettled([
      setCurrentBankDestination({ sellerId: sellerRace.id, iban: ibanB, beneficiaryName: "Race A", expectedCoordinationVersion: 1, idempotencyKey: `slice-d-race-a-${key()}` }, prisma),
      setCurrentBankDestination({ sellerId: sellerRace.id, iban: ibanB, beneficiaryName: "Race B", expectedCoordinationVersion: 1, idempotencyKey: `slice-d-race-b-${key()}` }, prisma),
    ]);
    const winners = raced.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof setCurrentBankDestination>>> => result.status === "fulfilled");
    const losers = raced.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(winners.length, 1, "concurrent bank changes did not produce one winner");
    assert.equal(losers.length, 1);
    assert(losers[0].reason instanceof BankDestinationError && losers[0].reason.code === "STALE_CONTEXT", `unexpected race loser: ${String(losers[0].reason)}`);
    ids.revisions.push(winners[0].value.revision.id);
    const raceIdentity = await prisma.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: raceFirst.identity.id }, include: { currentBankDestinationRevision: true } });
    assert.equal(raceIdentity.coordinationVersion, 2);
    assert.equal(raceIdentity.currentBankDestinationRevisionId, winners[0].value.revision.id);
    assert.equal(raceIdentity.holdActive, true);
    assert.equal(raceIdentity.holdReasonCode, "BANK_VERIFICATION_REQUIRED");
    assert.equal(await prisma.bankDestinationRevision.count({ where: { financialIdentityId: raceIdentity.id, destinationVersion: 2 } }), 1);
    assert.equal(await prisma.sellerPayout.count({ where: { sellerId: { in: ids.sellers } } }), 0, "bank change altered payout state");
    assert.equal(await prisma.financialLedgerEntry.count({ where: { sellerId: { in: ids.sellers } } }), 0, "bank change altered ledger state");
    assert.equal(await prisma.sellerPayout.count({ where: { sellerId: { in: ids.sellers }, status: "BLOCKED" } }), 0, "identity hold reused SellerPayout.BLOCKED");
    assert.equal(await prisma.bankDestinationRevision.count({ where: { financialIdentityId: { in: ids.identities }, verificationAssurance: { not: "LOCAL_CHECKS_ONLY" }, id: { not: first.revision.id } } }), 0, "bank command manufactured trusted assurance");
    console.log("PASS: #20 Slice D TEST DB immutable revisions, hold, replay, isolation and single-winner concurrency");
  } finally {
    await cleanup();
    assert.equal(await prisma.sellerFinancialIdentity.count({ where: { sellerId: { in: ids.sellers } } }), 0, "Slice D cleanup failed");
    await prisma.$disconnect();
  }
}

void main();
