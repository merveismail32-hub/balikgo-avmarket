import "server-only";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Prisma, type InstallmentCommercialPolicy, type SellerOffer } from "@prisma/client";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { setOwnSellerInstallmentPreference, setSellerInstallmentAuthorization } from "../app/lib/seller-installment-control";
import { createInstallmentCommercialPolicy } from "../app/lib/installment-commercial-policy";
import { resolveCheckoutCommercialInstallments } from "../app/lib/payments/commercial-installment-resolution";
import { decrementForCheckout } from "../app/lib/stock-truth";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const token = crypto.randomUUID();
const emailPrefix = `qa-commercial-checkout-${token}`;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true, sellerProfile: { select: { id: true } } } });
  const userIds = users.map((user) => user.id);
  const sellerIds = users.flatMap((user) => user.sellerProfile ? [user.sellerProfile.id] : []);
  const policies = await prisma.installmentCommercialPolicy.findMany({ where: { createdByUserId: { in: userIds } }, select: { id: true } });
  if (policies.length) {
    await prisma.installmentCommercialPolicyAudit.deleteMany({ where: { policyId: { in: policies.map((policy) => policy.id) } } });
    await prisma.installmentCommercialPolicy.deleteMany({ where: { id: { in: policies.map((policy) => policy.id) } } });
  }
  if (sellerIds.length) {
    await prisma.sellerInstallmentControlAudit.deleteMany({ where: { sellerId: { in: sellerIds } } });
    await prisma.sellerInstallmentControl.deleteMany({ where: { sellerId: { in: sellerIds } } });
  }
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  if (sellerIds.length) {
    await prisma.stockMovement.deleteMany({ where: { sellerOffer: { sellerId: { in: sellerIds } } } });
    await prisma.sellerOffer.deleteMany({ where: { sellerId: { in: sellerIds } } });
    await prisma.product.deleteMany({ where: { sellerId: { in: sellerIds } } });
  }
  await prisma.catalogProduct.deleteMany({ where: { slug: { startsWith: `qa-commercial-checkout-${token}` } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: `qa-commercial-checkout-${token}` } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  await cleanup();
  try {
    const admin = await prisma.user.create({ data: { name: "QA", surname: "Admin", email: `${emailPrefix}-admin@invalid.local`, phone: "0", passwordHash: "qa", role: "ADMIN" } });
    const customer = await prisma.user.create({ data: { name: "QA", surname: "Customer", email: `${emailPrefix}-customer@invalid.local`, phone: "0", passwordHash: "qa" } });
    const sellers = await Promise.all([1, 2].map((index) => prisma.user.create({ data: { name: "QA", surname: `Seller ${index}`, email: `${emailPrefix}-seller-${index}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: `QA Commercial ${index}`, companyType: "QA", taxNumber: `${token}-${index}`, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } })));
    const category = await prisma.category.create({ data: { name: "QA Commercial", slug: `qa-commercial-checkout-${token}` } });
    const offers: SellerOffer[] = [];
    const createdPolicies: InstallmentCommercialPolicy[] = [];
    for (const [index, seller] of sellers.entries()) {
      const catalog = await prisma.catalogProduct.create({ data: { slug: `qa-commercial-checkout-${token}-${index}`, name: "QA", brand: "QA", category: "QA", categoryId: category.id, description: "QA", imageUrl: "/qa.jpg" } });
      const product = await prisma.product.create({ data: { sellerId: seller.sellerProfile!.id, catalogProductId: catalog.id, name: "QA", slug: `qa-commercial-checkout-${token}-p-${index}`, category: "QA", brand: "QA", price: 100, stock: 5, description: "QA", imageUrl: "/qa.jpg" } });
      offers.push(await prisma.sellerOffer.create({ data: { sellerId: seller.sellerProfile!.id, catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: `QA-${token}-${index}`, price: 100, stock: 5 } }));
    }
    for (const [index, seller] of sellers.entries()) {
      const allowed = index === 0 ? [1, 3, 6] : [1, 3];
      const control = await setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: seller.sellerProfile!.id, authorizationMode: "DELEGATED", delegatedAllowedInstallments: allowed, expectedVersion: 0, reason: "QA checkout authority" }, prisma);
      await setOwnSellerInstallmentPreference({ actorUserId: seller.id, controlId: control.id, participationEnabled: true, sellerPreferenceAllowedInstallments: allowed, expectedVersion: 1, reason: "QA checkout preference" }, prisma);
      createdPolicies.push(await createInstallmentCommercialPolicy({ actorUserId: admin.id, scopeType: "SELLER", sellerId: seller.sellerProfile!.id, allowedInstallments: allowed, minimumEligibleAmount: 0, effectiveFrom: new Date("2026-01-01"), reason: "QA checkout policy" }, prisma));
    }
    const beforeStock = offers.map((offer) => offer.stock);
    await assert.rejects(prisma.$transaction(async (tx) => {
      await decrementForCheckout(tx, { sellerOfferId: offers[0].id, productId: offers[0].legacyProductId!, sellerId: offers[0].sellerId, quantity: 1, idempotencyKey: `qa-rollback-${token}`, source: "CHECKOUT", actorSellerId: offers[0].sellerId });
      throw new Error("QA_ROLLBACK");
    }), /QA_ROLLBACK/);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offers[0].id } })).stock, beforeStock[0]);

    const clientRequestId = crypto.randomUUID();
    const created = await prisma.$transaction(async (tx) => {
      const effectiveAt = new Date();
      for (const offer of offers) await decrementForCheckout(tx, { sellerOfferId: offer.id, productId: offer.legacyProductId!, sellerId: offer.sellerId, quantity: 1, idempotencyKey: `checkout:${clientRequestId}:${offer.id}`, source: "CHECKOUT", actorSellerId: offer.sellerId });
      const decision = await resolveCheckoutCommercialInstallments({ lines: offers.map((offer) => ({ sellerId: offer.sellerId, categoryId: category.id, sellerOfferId: offer.id, eligibleAmount: new Prisma.Decimal(100) })), effectiveAt, provider: "TEST", requestedInstallmentCount: 1, legalConstraint: { status: "UNKNOWN" } }, tx);
      assert.deepEqual(decision.commercialAllowedInstallments, [1, 3]);
      assert.deepEqual(decision.resolution.effectiveAllowedInstallments, [1]);
      const order = await tx.order.create({ data: { userId: customer.id, orderNumber: `QA-${token}`, clientRequestId, totalAmount: 200, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: offers.map((offer) => ({ productId: offer.legacyProductId!, catalogProductId: offer.catalogProductId, sellerOfferId: offer.id, sellerId: offer.sellerId, productName: "QA", productImageUrl: "/qa.jpg", unitPrice: 100, quantity: 1, stockReservationState: "RESERVED" })) } } });
      const payment = await tx.payment.create({ data: { orderId: order.id, amount: 200, idempotencyKey: `order:${clientRequestId}:payment`, selectedInstallmentCount: decision.resolution.selectedInstallmentCount, installmentPolicySource: decision.resolution.commercialProvenance.source, installmentPolicyReference: decision.resolution.commercialProvenance.sourceReference, installmentPolicyVersion: decision.resolution.commercialProvenance.policyVersion, installmentProvider: decision.resolution.providerProvenance.provider, installmentProviderCapabilitySource: decision.resolution.providerProvenance.source, installmentProviderCapabilityReference: decision.resolution.providerProvenance.sourceReference, installmentCommercialSnapshot: decision.internalSnapshot } });
      return { order, payment };
    });
    const snapshot = JSON.stringify(created.payment.installmentCommercialSnapshot);
    await prisma.sellerInstallmentControl.updateMany({ where: { sellerId: sellers[0].sellerProfile!.id }, data: { participationEnabled: false, version: { increment: 1 } } });
    await prisma.installmentCommercialPolicy.update({ where: { id: createdPolicies[0].id }, data: { allowedInstallments: [1], version: { increment: 1 } } });
    const retry = await prisma.order.findUniqueOrThrow({ where: { clientRequestId }, include: { payment: true } });
    assert.equal(retry.id, created.order.id);
    assert.equal(retry.payment?.selectedInstallmentCount, 1);
    assert.equal(JSON.stringify(retry.payment?.installmentCommercialSnapshot), snapshot);
    assert.equal((retry.payment?.installmentCommercialSnapshot as { policies?: unknown[] }).policies?.length, 2);
    const afterStock = await prisma.sellerOffer.findMany({ where: { id: { in: offers.map((offer) => offer.id) } }, orderBy: { id: "asc" }, select: { stock: true } });
    assert.deepEqual(afterStock.map((offer) => offer.stock).sort(), [4, 4]);
    console.log("PASS: #24 Slice E guarded TEST DB multi-seller resolution, Payment snapshot, retry immutability, rollback and stock integrity");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
