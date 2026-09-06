import "server-only";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { SellerOffer } from "@prisma/client";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { createInstallmentCommercialPolicy } from "../app/lib/installment-commercial-policy";
import { getAdminInstallmentAuditTimeline, getAdminInstallmentOverview, getSellerInstallmentReadModel, InstallmentReadModelError } from "../app/lib/installment-read-model";
import { setOwnSellerInstallmentPreference, setSellerInstallmentAuthorization } from "../app/lib/seller-installment-control";
import { decideSellerInstallmentRequest, submitSellerInstallmentRequest } from "../app/lib/seller-installment-request";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const token = crypto.randomUUID();
const prefix = `qa-read-${token}`;
const is = (code: string) => (error: unknown) => error instanceof InstallmentReadModelError && error.code === code;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true, sellerProfile: { select: { id: true } } } });
  const userIds = users.map((user) => user.id);
  const sellerIds = users.flatMap((user) => user.sellerProfile ? [user.sellerProfile.id] : []);
  const policies = await prisma.installmentCommercialPolicy.findMany({ where: { createdByUserId: { in: userIds } }, select: { id: true } });
  if (policies.length) {
    await prisma.installmentCommercialPolicyAudit.deleteMany({ where: { policyId: { in: policies.map((policy) => policy.id) } } });
    await prisma.installmentCommercialPolicy.deleteMany({ where: { id: { in: policies.map((policy) => policy.id) } } });
  }
  if (sellerIds.length) {
    await prisma.sellerInstallmentRequestAudit.deleteMany({ where: { sellerId: { in: sellerIds } } });
    await prisma.sellerInstallmentRequest.deleteMany({ where: { sellerId: { in: sellerIds } } });
    await prisma.sellerInstallmentControlAudit.deleteMany({ where: { sellerId: { in: sellerIds } } });
    await prisma.sellerInstallmentControl.deleteMany({ where: { sellerId: { in: sellerIds } } });
    await prisma.sellerOffer.deleteMany({ where: { sellerId: { in: sellerIds } } });
    await prisma.product.deleteMany({ where: { sellerId: { in: sellerIds } } });
  }
  await prisma.catalogProduct.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: prefix } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  await cleanup();
  try {
    const admin = await prisma.user.create({ data: { name: "QA", surname: "Admin", email: `${prefix}-admin@invalid.local`, phone: "0", passwordHash: "qa", role: "ADMIN" } });
    const customer = await prisma.user.create({ data: { name: "QA", surname: "Customer", email: `${prefix}-customer@invalid.local`, phone: "0", passwordHash: "qa" } });
    const sellers = await Promise.all([1, 2].map((index) => prisma.user.create({ data: { name: "QA", surname: `Seller ${index}`, email: `${prefix}-seller-${index}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: `QA Read ${index}`, companyType: "QA", taxNumber: `${token}-${index}`, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } })));
    const category = await prisma.category.create({ data: { name: "QA Read", slug: prefix } });
    const offers: SellerOffer[] = [];
    for (const [index, seller] of sellers.entries()) {
      const catalog = await prisma.catalogProduct.create({ data: { slug: `${prefix}-catalog-${index}`, name: "QA", brand: "QA", category: "QA", categoryId: category.id, description: "QA", imageUrl: "/qa.jpg" } });
      const product = await prisma.product.create({ data: { sellerId: seller.sellerProfile!.id, catalogProductId: catalog.id, name: "QA", slug: `${prefix}-product-${index}`, category: "QA", brand: "QA", price: 100, stock: 1, description: "QA", imageUrl: "/qa.jpg" } });
      offers.push(await prisma.sellerOffer.create({ data: { sellerId: seller.sellerProfile!.id, catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: `${prefix}-${index}`, price: 100, stock: 1 } }));
    }
    const control = await setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: sellers[0].sellerProfile!.id, authorizationMode: "REQUEST_ONLY", delegatedAllowedInstallments: [1], expectedVersion: 0, reason: "QA initial control" }, prisma);
    const approved = await submitSellerInstallmentRequest({ actorUserId: sellers[0].id, scopeType: "SELLER", requestedAllowedInstallments: [1, 3, 6], reason: "QA approve request" }, prisma);
    await decideSellerInstallmentRequest({ actorUserId: admin.id, requestId: approved.id, decision: "APPROVE", approvedAllowedInstallments: [1, 3, 6], expectedVersion: 1, expectedControlVersion: control.version, reason: "QA approved" }, prisma);
    const current = await prisma.sellerInstallmentControl.findUniqueOrThrow({ where: { sellerId: sellers[0].sellerProfile!.id } });
    await setOwnSellerInstallmentPreference({ actorUserId: sellers[0].id, controlId: current.id, participationEnabled: true, sellerPreferenceAllowedInstallments: [1, 6], expectedVersion: current.version, reason: "QA preference" }, prisma);
    const rejected = await submitSellerInstallmentRequest({ actorUserId: sellers[0].id, scopeType: "SELLER", requestedAllowedInstallments: [1, 9], reason: "QA reject request" }, prisma);
    await decideSellerInstallmentRequest({ actorUserId: admin.id, requestId: rejected.id, decision: "REJECT", expectedVersion: 1, reason: "QA rejected" }, prisma);
    await submitSellerInstallmentRequest({ actorUserId: sellers[0].id, scopeType: "SELLER_OFFER", sellerOfferId: offers[0].id, requestedAllowedInstallments: [1, 9], reason: "QA pending offer" }, prisma);
    const now = new Date();
    const future = new Date(now.getTime() + 86_400_000);
    await createInstallmentCommercialPolicy({ actorUserId: admin.id, scopeType: "SELLER", sellerId: sellers[0].sellerProfile!.id, allowedInstallments: [1, 3, 6], minimumEligibleAmount: 0, effectiveFrom: new Date(now.getTime() - 86_400_000), effectiveUntil: future, reason: "QA active policy" }, prisma);
    await createInstallmentCommercialPolicy({ actorUserId: admin.id, scopeType: "SELLER", sellerId: sellers[0].sellerProfile!.id, allowedInstallments: [1, 3], minimumEligibleAmount: 0, effectiveFrom: future, reason: "QA scheduled policy" }, prisma);
    await prisma.sellerInstallmentControl.update({ where: { id: current.id }, data: { delegatedAllowedInstallments: [1, 3], sellerPreferenceAllowedInstallments: [1, 6], version: { increment: 1 } } });

    const overview = await getAdminInstallmentOverview({ actorUserId: admin.id, sellerId: sellers[0].sellerProfile!.id, offerId: offers[0].id, amount: "100", limit: 1, now }, prisma);
    assert.equal(overview.items.length, 1);
    assert.equal(overview.items[0].seller.storeName, "QA Read 1");
    assert(overview.items[0].policies.some((policy) => policy.state === "ACTIVE"));
    assert(overview.items[0].policies.some((policy) => policy.state === "SCHEDULED"));
    assert(overview.items[0].requests.some((request) => request.status === "SUBMITTED"));
    assert(overview.items[0].requests.some((request) => request.status === "APPROVED"));
    assert(overview.items[0].requests.some((request) => request.status === "REJECTED"));
    assert(overview.items[0].conflicts.includes("PREFERENCE_OUTSIDE_DELEGATION"));
    assert.deepEqual(overview.effectiveOutcome?.effectiveInstallmentOptions, [1]);
    assert.equal(overview.page.limit, 1);
    await assert.rejects(getAdminInstallmentOverview({ actorUserId: customer.id }, prisma), is("FORBIDDEN"));

    const own = await getSellerInstallmentReadModel({ actorUserId: sellers[0].id, offerId: offers[0].id, amount: "100", now }, prisma);
    assert.equal(own.seller.id, sellers[0].sellerProfile!.id);
    assert.equal(own.conflictReason, "PREFERENCE_OUTSIDE_DELEGATION");
    assert(own.requests.some((request) => request.sellerOfferId === offers[0].id));
    assert(own.effectiveView);
    const text = JSON.stringify(own);
    for (const forbidden of ["actorUserId", "createdByUserId", "installmentProviderCapabilityReference", "LEGAL_CONSTRAINT_UNKNOWN", "approvedFromRequestId"]) assert(!text.includes(forbidden));
    await assert.rejects(getSellerInstallmentReadModel({ actorUserId: sellers[0].id, offerId: offers[1].id, amount: "100", now }, prisma), is("OFFER_NOT_FOUND"));
    await assert.rejects(getSellerInstallmentReadModel({ actorUserId: customer.id }, prisma), is("FORBIDDEN"));

    const audit = await getAdminInstallmentAuditTimeline({ actorUserId: admin.id, sellerId: sellers[0].sellerProfile!.id, limit: 3 }, prisma);
    assert.equal(audit.items.length, 3);
    assert(audit.items.every((item, index) => index === 0 || audit.items[index - 1].timestamp >= item.timestamp));
    assert(audit.items.every((item) => !JSON.stringify(item).includes("actorUserId")));
    assert.equal(audit.page.limit, 3);
    const nextAudit = await getAdminInstallmentAuditTimeline({ actorUserId: admin.id, sellerId: sellers[0].sellerProfile!.id, limit: 2, offset: 2 }, prisma);
    assert(nextAudit.items.every((item) => !audit.items.slice(0, 2).some((first) => first.id === item.id)));
    console.log("PASS: #24 Slice F guarded TEST DB CEO/seller read models, IDOR, bounded audit and safe field separation");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
