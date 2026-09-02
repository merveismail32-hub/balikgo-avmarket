import "server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { recordCurrentTaxLocalValidation } from "../app/lib/tax-verification";
import { setCurrentBankDestination } from "../app/lib/bank-destination";
import { reviewBankDestination, reviewTaxVerification } from "../app/lib/financial-review";
import { getPayoutTransferEligibility, reconcileFinancialIdentityHold } from "../app/lib/payout-eligibility";

const env = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const key = () => randomUUID();
const ids = { users: [] as string[], sellers: [] as string[], products: [] as string[], orders: [] as string[] };
const ibanA = "TR470000100100000350930001", ibanB = "TR330006100519786457841326";

async function cleanup() {
  if (ids.orders.length) {
    const refunds = await prisma.refund.findMany({ where: { orderId: { in: ids.orders } }, select: { id: true } });
    if (refunds.length) await prisma.financialLedgerEntry.deleteMany({ where: { refundId: { in: refunds.map(({ id }) => id) } } });
    await prisma.refund.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.financialLedgerEntry.deleteMany({ where: { orderItem: { orderId: { in: ids.orders } } } });
    await prisma.sellerPayout.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  }
  if (ids.sellers.length) {
    await prisma.financialVerificationEvidence.deleteMany({ where: { sellerId: { in: ids.sellers } } });
    const identities = await prisma.sellerFinancialIdentity.findMany({ where: { sellerId: { in: ids.sellers } }, select: { id: true } });
    if (identities.length) {
      await prisma.sellerFinancialIdentity.updateMany({ where: { id: { in: identities.map(({ id }) => id) } }, data: { currentBankDestinationRevisionId: null } });
      await prisma.bankDestinationRevision.deleteMany({ where: { financialIdentityId: { in: identities.map(({ id }) => id) } } });
      await prisma.sellerFinancialIdentity.deleteMany({ where: { id: { in: identities.map(({ id }) => id) } } });
    }
    await prisma.taxVerification.deleteMany({ where: { sellerId: { in: ids.sellers } } });
  }
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function main() {
  await cleanup();
  try {
    const token = key();
    const sellerUser = await prisma.user.create({ data: { name: "F", surname: "Seller", email: `slice-f-s-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: "Slice F", storeSlug: `slice-f-${token}`, legalName: "Slice F A.Ş.", companyType: "Anonim Şirket", taxNumber: "10000000146", taxOffice: "Kadıköy", city: "QA", address: "QA", description: "QA", status: "APPROVED", onboardingStatus: "APPROVED", activationEligible: true } } }, include: { sellerProfile: true } });
    const reviewer = await prisma.user.create({ data: { name: "F", surname: "Reviewer", email: `slice-f-r-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "ADMIN", financialIdentityReviewerEnabled: true } });
    const customer = await prisma.user.create({ data: { name: "F", surname: "Customer", email: `slice-f-c-${token}@invalid.local`, phone: "0", passwordHash: "qa" } });
    ids.users.push(sellerUser.id, reviewer.id, customer.id); ids.sellers.push(sellerUser.sellerProfile!.id);
    const product = await prisma.product.create({ data: { sellerId: sellerUser.sellerProfile!.id, name: "Slice F Product", slug: `slice-f-product-${token}`, category: "QA", brand: "QA", price: 100, stock: 1, description: "QA", imageUrl: "/qa" } }); ids.products.push(product.id);
    const order = await prisma.order.create({ data: { userId: customer.id, orderNumber: `SF-${token}`, clientRequestId: `SF-${token}`, totalAmount: 100, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: { productId: product.id, sellerId: sellerUser.sellerProfile!.id, productName: product.name, productImageUrl: product.imageUrl, unitPrice: 100, quantity: 1, status: "DELIVERED" } }, payment: { create: { amount: 100, status: "PAID" } } }, include: { items: true, payment: true } }); ids.orders.push(order.id);
    const payout = await prisma.sellerPayout.create({ data: { sellerId: sellerUser.sellerProfile!.id, orderId: order.id, orderItemId: order.items[0].id, grossAmount: 100, commissionAmount: 10, netAmount: 90, status: "AVAILABLE", availableAt: new Date() } });
    await prisma.financialLedgerEntry.create({ data: { sellerId: sellerUser.sellerProfile!.id, orderItemId: order.items[0].id, payoutId: payout.id, type: "SALE", amount: 100, dedupeKey: `slice-f-ledger-${token}` } });
    const tax = await recordCurrentTaxLocalValidation({ sellerId: sellerUser.sellerProfile!.id, expectedOnboardingVersion: 0, identifierType: "TCKN", idempotencyKey: `slice-f-tax-${key()}` }, prisma);
    await reviewTaxVerification({ authenticatedUserId: reviewer.id }, { taxVerificationId: tax.id, expectedOnboardingVersion: 0, expectedIdentifierType: "TCKN", expectedFingerprint: tax.normalizedFingerprint, decision: "APPROVE", reasonCode: "DOCUMENTS_MATCH", evidenceReference: `vault://slice-f/tax-${key()}`, idempotencyKey: `slice-f-tax-review-${key()}` }, prisma);
    const bank = await setCurrentBankDestination({ sellerId: sellerUser.sellerProfile!.id, iban: ibanA, beneficiaryName: "Slice F A.Ş.", expectedCoordinationVersion: 0, idempotencyKey: `slice-f-bank-${key()}` }, prisma);
    await reviewBankDestination({ authenticatedUserId: reviewer.id }, { bankDestinationRevisionId: bank.revision.id, expectedCoordinationVersion: 1, expectedDestinationVersion: 1, expectedFingerprint: bank.revision.normalizedFingerprint, decision: "APPROVE", reasonCode: "DOCUMENTS_MATCH", evidenceReference: `vault://slice-f/bank-${key()}`, idempotencyKey: `slice-f-bank-review-${key()}` }, prisma);

    assert.equal((await getPayoutTransferEligibility(payout.id, prisma))?.transferEligible, false, "active hold allowed transfer");
    const ledgerBefore = await prisma.financialLedgerEntry.count({ where: { orderItemId: order.items[0].id } });
    const released = await reconcileFinancialIdentityHold({ sellerId: sellerUser.sellerProfile!.id, expectedCoordinationVersion: 1 }, prisma);
    assert.equal(released.released, true);
    assert.equal((await getPayoutTransferEligibility(payout.id, prisma))?.transferEligible, true);
    assert.equal((await prisma.sellerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "AVAILABLE");
    assert.equal(await prisma.financialLedgerEntry.count({ where: { orderItemId: order.items[0].id } }), ledgerBefore);

    await prisma.sellerProfile.update({ where: { id: sellerUser.sellerProfile!.id }, data: { status: "SUSPENDED" } });
    const suspended = await getPayoutTransferEligibility(payout.id, prisma);
    assert.equal(suspended?.transferEligible, false); assert(suspended?.reasons.includes("SELLER_NOT_OPERATIONAL"));
    assert.equal((await prisma.sellerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "AVAILABLE");
    await prisma.sellerProfile.update({ where: { id: sellerUser.sellerProfile!.id }, data: { status: "APPROVED" } });

    const refund = await prisma.refund.create({ data: { paymentId: order.payment!.id, orderId: order.id, orderItemId: order.items[0].id, sellerId: sellerUser.sellerProfile!.id, requestedByUserId: customer.id, idempotencyKey: `slice-f-refund-${token}`, amount: 10, reason: "QA", status: "REQUESTED" } });
    const refunded = await getPayoutTransferEligibility(payout.id, prisma);
    assert.equal(refunded?.transferEligible, false); assert(refunded?.reasons.includes("REFUND_OR_DISPUTE_BLOCK"));
    assert.equal((await prisma.sellerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "AVAILABLE");
    assert.equal(await prisma.financialLedgerEntry.count({ where: { orderItemId: order.items[0].id } }), ledgerBefore);
    await prisma.refund.delete({ where: { id: refund.id } });

    await prisma.sellerFinancialIdentity.update({ where: { id: bank.identity.id }, data: { holdActive: true, holdReasonCode: "BANK_VERIFICATION_REQUIRED", holdSetAt: new Date(), holdReleasedAt: null } });
    const bankHoldRace = await Promise.allSettled([
      setCurrentBankDestination({ sellerId: sellerUser.sellerProfile!.id, iban: ibanB, beneficiaryName: "Slice F Changed", expectedCoordinationVersion: 2, idempotencyKey: `slice-f-bank-race-${key()}` }, prisma),
      reconcileFinancialIdentityHold({ sellerId: sellerUser.sellerProfile!.id, expectedCoordinationVersion: 2 }, prisma),
    ]);
    let changedBank = bankHoldRace[0].status === "fulfilled" ? bankHoldRace[0].value : null;
    if (!changedBank) {
      const afterReleaseRace = await prisma.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: bank.identity.id } });
      changedBank = await setCurrentBankDestination({ sellerId: sellerUser.sellerProfile!.id, iban: ibanB, beneficiaryName: "Slice F Changed", expectedCoordinationVersion: afterReleaseRace.coordinationVersion, idempotencyKey: `slice-f-bank-after-race-${key()}` }, prisma);
    }
    const staleRelease = await reconcileFinancialIdentityHold({ sellerId: sellerUser.sellerProfile!.id, expectedCoordinationVersion: changedBank.identity.coordinationVersion - 1 }, prisma);
    assert.equal(staleRelease.released, false); assert.equal(staleRelease.reason, "STALE_CONTEXT");
    assert.equal(changedBank.revision.verificationStatus, "UNVERIFIED");
    assert.equal((await getPayoutTransferEligibility(payout.id, prisma))?.transferEligible, false);
    await reviewBankDestination({ authenticatedUserId: reviewer.id }, { bankDestinationRevisionId: changedBank.revision.id, expectedCoordinationVersion: changedBank.identity.coordinationVersion, expectedDestinationVersion: 2, expectedFingerprint: changedBank.revision.normalizedFingerprint, decision: "APPROVE", reasonCode: "DOCUMENTS_MATCH", evidenceReference: `vault://slice-f/bank2-${key()}`, idempotencyKey: `slice-f-bank2-review-${key()}` }, prisma);

    const beforeTaxRace = await prisma.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: bank.identity.id } });
    const taxHoldRace = await Promise.allSettled([
      reconcileFinancialIdentityHold({ sellerId: sellerUser.sellerProfile!.id, expectedCoordinationVersion: beforeTaxRace.coordinationVersion }, prisma),
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${sellerUser.sellerProfile!.id} FOR UPDATE`;
        await tx.sellerProfile.update({ where: { id: sellerUser.sellerProfile!.id }, data: { onboardingVersion: { increment: 1 }, taxOffice: "Changed Office" } });
        await tx.$queryRaw`SELECT "id" FROM "SellerFinancialIdentity" WHERE "id" = ${bank.identity.id} FOR UPDATE`;
        await tx.sellerFinancialIdentity.update({ where: { id: bank.identity.id }, data: { holdActive: true, holdReasonCode: "TAX_VERIFICATION_REQUIRED", holdSetAt: new Date(), holdReleasedAt: null, coordinationVersion: { increment: 1 } } });
      }, { isolationLevel: "Serializable" }),
    ]);
    assert(taxHoldRace.some((result) => result.status === "fulfilled"), "KYB/hold race had no successful operation");
    if (taxHoldRace[1].status === "rejected") {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${sellerUser.sellerProfile!.id} FOR UPDATE`;
        await tx.sellerProfile.update({ where: { id: sellerUser.sellerProfile!.id }, data: { onboardingVersion: { increment: 1 }, taxOffice: "Changed Office" } });
        await tx.$queryRaw`SELECT "id" FROM "SellerFinancialIdentity" WHERE "id" = ${bank.identity.id} FOR UPDATE`;
        await tx.sellerFinancialIdentity.update({ where: { id: bank.identity.id }, data: { holdActive: true, holdReasonCode: "TAX_VERIFICATION_REQUIRED", holdSetAt: new Date(), holdReleasedAt: null, coordinationVersion: { increment: 1 } } });
      }, { isolationLevel: "Serializable" });
    }
    const finalIdentity = await prisma.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: bank.identity.id } });
    assert.equal(finalIdentity.holdActive, true);
    assert.equal((await getPayoutTransferEligibility(payout.id, prisma))?.transferEligible, false);
    assert.equal((await prisma.sellerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "AVAILABLE");
    assert.equal(await prisma.financialLedgerEntry.count({ where: { orderItemId: order.items[0].id } }), ledgerBefore);
    console.log("PASS: #20 Slice F TEST DB eligibility, hold release, stale bank/tax, suspension and refund guards");
  } finally { await cleanup(); await prisma.$disconnect(); }
}

void main();
