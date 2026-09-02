import "server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { recordCurrentTaxLocalValidation } from "../app/lib/tax-verification";
import { setCurrentBankDestination } from "../app/lib/bank-destination";
import { reviewBankDestination, reviewTaxVerification } from "../app/lib/financial-review";
import { reconcileFinancialIdentityHold } from "../app/lib/payout-eligibility";
import { getAdminSellerFinanceSummary, getFinancialReviewerIdentityDetail, getOwnSellerFinanceSummary } from "../app/lib/finance-read-model";
import { adminSellerApplicationSummarySelect, toAdminSellerApplicationSummaryDto } from "../app/lib/admin-seller-application-dto";

const env = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const key = () => randomUUID(), rawTax = "10000000146", rawIban = "TR470000100100000350930001";
const ids = { users: [] as string[], sellers: [] as string[], products: [] as string[], orders: [] as string[] };
async function cleanup() {
  if (ids.orders.length) { await prisma.refund.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.financialLedgerEntry.deleteMany({ where: { orderItem: { orderId: { in: ids.orders } } } }); await prisma.sellerPayout.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.payment.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.sellers.length) { await prisma.financialVerificationEvidence.deleteMany({ where: { sellerId: { in: ids.sellers } } }); const identities = await prisma.sellerFinancialIdentity.findMany({ where: { sellerId: { in: ids.sellers } }, select: { id: true } }); if (identities.length) { const values = identities.map(({ id }) => id); await prisma.sellerFinancialIdentity.updateMany({ where: { id: { in: values } }, data: { currentBankDestinationRevisionId: null } }); await prisma.bankDestinationRevision.deleteMany({ where: { financialIdentityId: { in: values } } }); await prisma.sellerFinancialIdentity.deleteMany({ where: { id: { in: values } } }); } await prisma.taxVerification.deleteMany({ where: { sellerId: { in: ids.sellers } } }); }
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } }); if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } }); if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}
async function main() {
  await cleanup();
  try {
    const token = key();
    const seller = await prisma.user.create({ data: { name: "G", surname: "Seller", email: `slice-g-s-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: "Slice G", storeSlug: `slice-g-${token}`, legalName: "Slice G A.Ş.", companyType: "Anonim Şirket", taxNumber: rawTax, taxOffice: "Kadıköy", city: "QA", address: "QA", description: "QA", status: "APPROVED", onboardingStatus: "APPROVED", activationEligible: true } } }, include: { sellerProfile: true } });
    const other = await prisma.user.create({ data: { name: "G", surname: "Other", email: `slice-g-o-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER" } });
    const admin = await prisma.user.create({ data: { name: "G", surname: "Admin", email: `slice-g-a-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "ADMIN" } });
    const reviewer = await prisma.user.create({ data: { name: "G", surname: "Reviewer", email: `slice-g-r-${token}@invalid.local`, phone: "0", passwordHash: "qa", role: "ADMIN", financialIdentityReviewerEnabled: true } });
    const customer = await prisma.user.create({ data: { name: "G", surname: "Customer", email: `slice-g-c-${token}@invalid.local`, phone: "0", passwordHash: "qa" } });
    ids.users.push(seller.id, other.id, admin.id, reviewer.id, customer.id); ids.sellers.push(seller.sellerProfile!.id);
    const product = await prisma.product.create({ data: { sellerId: seller.sellerProfile!.id, name: "Slice G", slug: `slice-g-product-${token}`, category: "QA", brand: "QA", price: 100, stock: 1, description: "QA", imageUrl: "/qa" } }); ids.products.push(product.id);
    const order = await prisma.order.create({ data: { userId: customer.id, orderNumber: `SG-${token}`, clientRequestId: `SG-${token}`, totalAmount: 100, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: { productId: product.id, sellerId: seller.sellerProfile!.id, productName: product.name, productImageUrl: product.imageUrl, unitPrice: 100, quantity: 1, status: "DELIVERED" } }, payment: { create: { amount: 100, status: "PAID" } } }, include: { items: true, payment: true } }); ids.orders.push(order.id);
    const payout = await prisma.sellerPayout.create({ data: { sellerId: seller.sellerProfile!.id, orderId: order.id, orderItemId: order.items[0].id, grossAmount: 100, commissionAmount: 10, netAmount: 90, status: "AVAILABLE" } });
    await prisma.financialLedgerEntry.create({ data: { sellerId: seller.sellerProfile!.id, orderItemId: order.items[0].id, payoutId: payout.id, type: "SALE", amount: 100, dedupeKey: `slice-g-ledger-${token}` } });
    const tax = await recordCurrentTaxLocalValidation({ sellerId: seller.sellerProfile!.id, expectedOnboardingVersion: 0, identifierType: "TCKN", idempotencyKey: `slice-g-tax-${key()}` }, prisma);
    await reviewTaxVerification({ authenticatedUserId: reviewer.id }, { taxVerificationId: tax.id, expectedOnboardingVersion: 0, expectedIdentifierType: "TCKN", expectedFingerprint: tax.normalizedFingerprint, decision: "APPROVE", reasonCode: "DOCUMENTS_MATCH", evidenceReference: `vault://g/tax-${key()}`, idempotencyKey: `slice-g-tax-review-${key()}` }, prisma);
    const bank = await setCurrentBankDestination({ sellerId: seller.sellerProfile!.id, iban: rawIban, beneficiaryName: "Slice G A.Ş.", expectedCoordinationVersion: 0, idempotencyKey: `slice-g-bank-${key()}` }, prisma);
    await reviewBankDestination({ authenticatedUserId: reviewer.id }, { bankDestinationRevisionId: bank.revision.id, expectedCoordinationVersion: 1, expectedDestinationVersion: 1, expectedFingerprint: bank.revision.normalizedFingerprint, decision: "APPROVE", reasonCode: "DOCUMENTS_MATCH", evidenceReference: `vault://g/bank-${key()}`, idempotencyKey: `slice-g-bank-review-${key()}` }, prisma);
    const ledgerBefore = await prisma.financialLedgerEntry.count({ where: { orderItemId: order.items[0].id } });
    const held = await getOwnSellerFinanceSummary(seller.id, prisma); const heldJson = JSON.stringify(held);
    assert(held && held.balances[0].economicallyAvailableAmount === "90.00" && held.balances[0].transferEligibleAmount === "0.00");
    assert(!heldJson.includes(rawTax) && !heldJson.includes(rawIban)); assert.equal(await getOwnSellerFinanceSummary(other.id, prisma), null);
    const adminSummary = await getAdminSellerFinanceSummary(admin.id, seller.sellerProfile!.id, prisma); assert(adminSummary && !JSON.stringify(adminSummary).includes(rawTax) && !JSON.stringify(adminSummary).includes(rawIban));
    const application = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: seller.sellerProfile!.id }, select: adminSellerApplicationSummarySelect });
    const applicationDto = toAdminSellerApplicationSummaryDto(application); const applicationJson = JSON.stringify(applicationDto);
    assert(!applicationJson.includes(rawTax) && !applicationJson.includes(rawIban)); assert.equal(applicationDto.financialVerification.tax.applicable, true); assert.equal(applicationDto.financialVerification.bank.applicable, true);
    assert.equal(await getFinancialReviewerIdentityDetail(admin.id, seller.sellerProfile!.id, prisma), null);
    const detail = await getFinancialReviewerIdentityDetail(reviewer.id, seller.sellerProfile!.id, prisma); assert.equal(detail?.taxIdentifier, rawTax); assert.equal(detail?.bankDestination?.canonicalIban, rawIban);
    await reconcileFinancialIdentityHold({ sellerId: seller.sellerProfile!.id, expectedCoordinationVersion: 1 }, prisma);
    const eligible = await getOwnSellerFinanceSummary(seller.id, prisma); assert.equal(eligible?.balances[0].transferEligibleAmount, "90.00");
    await prisma.sellerProfile.update({ where: { id: seller.sellerProfile!.id }, data: { status: "SUSPENDED" } }); const suspended = await getOwnSellerFinanceSummary(seller.id, prisma); assert.equal(suspended?.balances[0].economicallyAvailableAmount, "90.00"); assert.equal(suspended?.balances[0].transferEligibleAmount, "0.00");
    await prisma.sellerProfile.update({ where: { id: seller.sellerProfile!.id }, data: { status: "APPROVED" } }); const refund = await prisma.refund.create({ data: { paymentId: order.payment!.id, orderId: order.id, orderItemId: order.items[0].id, sellerId: seller.sellerProfile!.id, idempotencyKey: `slice-g-refund-${token}`, amount: 10, reason: "QA" } }); const refunded = await getOwnSellerFinanceSummary(seller.id, prisma); assert.equal(refunded?.balances[0].economicallyAvailableAmount, "90.00"); assert.equal(refunded?.balances[0].transferEligibleAmount, "0.00"); await prisma.refund.delete({ where: { id: refund.id } });
    await setCurrentBankDestination({ sellerId: seller.sellerProfile!.id, iban: "TR330006100519786457841326", beneficiaryName: "Changed", expectedCoordinationVersion: 2, idempotencyKey: `slice-g-bank-change-${key()}` }, prisma); const historical = await getOwnSellerFinanceSummary(seller.id, prisma); assert.equal(historical?.bankVerification.current, true); assert.equal(historical?.bankVerification.applicable, false); assert.equal(historical?.taxVerification.current, true);
    await prisma.sellerProfile.update({ where: { id: seller.sellerProfile!.id }, data: { onboardingVersion: { increment: 1 }, taxOffice: "Changed" } }); const staleTax = await getOwnSellerFinanceSummary(seller.id, prisma); assert.equal(staleTax?.taxVerification.current, false);
    assert.equal((await prisma.sellerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "AVAILABLE"); assert.equal(await prisma.financialLedgerEntry.count({ where: { orderItemId: order.items[0].id } }), ledgerBefore);
    console.log("PASS: #20 Slice G TEST DB masked DTO, IDOR, reviewer boundary, amounts and historical context safety");
  } finally { await cleanup(); await prisma.$disconnect(); }
}
void main();
