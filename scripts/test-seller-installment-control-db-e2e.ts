import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { evaluateSellerInstallmentControl, getSellerInstallmentControl, SellerInstallmentControlError, setOwnSellerInstallmentPreference, setSellerInstallmentAuthorization } from "../app/lib/seller-installment-control";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const suffix = crypto.randomUUID();
const emails = [`qa-installment-admin-${suffix}@invalid.local`, `qa-installment-a-${suffix}@invalid.local`, `qa-installment-b-${suffix}@invalid.local`];

const codeIs = (code: string) => (error: unknown) => error instanceof SellerInstallmentControlError && error.code === code;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "qa-installment-", endsWith: "@invalid.local" } }, select: { id: true, sellerProfile: { select: { id: true } } } });
  const sellerIds = users.flatMap((user) => user.sellerProfile ? [user.sellerProfile.id] : []);
  if (users.length) await prisma.order.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  if (sellerIds.length) {
    try {
      await prisma.sellerInstallmentControlAudit.deleteMany({ where: { sellerId: { in: sellerIds } } });
      await prisma.sellerInstallmentControl.deleteMany({ where: { sellerId: { in: sellerIds } } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2021") throw error;
    }
  }
  if (sellerIds.length) await prisma.product.deleteMany({ where: { sellerId: { in: sellerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
}

async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database, current_user role`;
  assert.equal(identity[0]?.database, TEST_DB_IDENTITY.database);
  assert.equal(identity[0]?.role, "postgres");
  const passwordHash = await hash("qa-only", 4);
  const admin = await prisma.user.create({ data: { name: "QA", surname: "Admin", email: emails[0], phone: "0", passwordHash, role: "ADMIN" } });
  const sellerAUser = await prisma.user.create({ data: { name: "QA", surname: "Seller A", email: emails[1], phone: "0", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: "QA A", companyType: "QA", taxNumber: suffix.slice(0, 10), taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
  const sellerBUser = await prisma.user.create({ data: { name: "QA", surname: "Seller B", email: emails[2], phone: "0", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: "QA B", companyType: "QA", taxNumber: suffix.slice(10, 20), taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
  const sellerA = sellerAUser.sellerProfile!;

  const historicalProduct = await prisma.product.create({ data: { sellerId: sellerA.id, name: "Historical QA Product", slug: `qa-installment-${suffix}`, category: "QA", brand: "QA", price: 100, stock: 1, description: "QA", imageUrl: "/qa.jpg" } });
  const historicalOrder = await prisma.order.create({ data: { userId: sellerBUser.id, orderNumber: `QA-INSTALLMENT-${suffix}`, clientRequestId: suffix, totalAmount: 100, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: { productId: historicalProduct.id, sellerId: sellerA.id, productName: historicalProduct.name, productImageUrl: historicalProduct.imageUrl, unitPrice: 100, quantity: 1 } }, payment: { create: { provider: "TEST", amount: 100, selectedInstallmentCount: 9, installmentPolicySource: "GLOBAL_CONFIG", installmentPolicyReference: "HISTORICAL_QA", installmentPolicyVersion: "INSTALLMENT_POLICY_V1", installmentProvider: "TEST", installmentProviderCapabilitySource: "PROVIDER_CAPABILITY", installmentProviderCapabilityReference: "HISTORICAL_QA" } } }, include: { payment: true } });
  const historicalSnapshot = { orderTotal: historicalOrder.totalAmount.toString(), selectedInstallmentCount: historicalOrder.payment!.selectedInstallmentCount, policyReference: historicalOrder.payment!.installmentPolicyReference };

  assert.deepEqual(await getSellerInstallmentControl(sellerA.id, prisma), evaluateSellerInstallmentControl(null));
  const created = await setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: sellerA.id, authorizationMode: "DELEGATED", delegatedAllowedInstallments: [1, 3, 6], expectedVersion: 0, reason: "Initial QA delegation" }, prisma);
  assert.equal(created.version, 1);
  assert.deepEqual(created.delegatedAllowedInstallments, [1, 3, 6]);
  await assert.rejects(() => setSellerInstallmentAuthorization({ actorUserId: sellerAUser.id, sellerId: sellerA.id, authorizationMode: "DELEGATED", delegatedAllowedInstallments: [1, 3, 6, 9], expectedVersion: 1, reason: "Privilege escalation" }, prisma), codeIs("FORBIDDEN"));
  await assert.rejects(() => setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: sellerA.id, authorizationMode: "DELEGATED", delegatedAllowedInstallments: [3, 6], expectedVersion: 1, reason: "Invalid delegation" }, prisma), codeIs("INVALID_ALLOWED_INSTALLMENTS"));
  await assert.rejects(() => setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: sellerA.id, authorizationMode: "DELEGATED", delegatedAllowedInstallments: [1, 99], expectedVersion: 1, reason: "Invalid delegation" }, prisma), codeIs("INVALID_ALLOWED_INSTALLMENTS"));

  const preferred = await setOwnSellerInstallmentPreference({ actorUserId: sellerAUser.id, controlId: created.id, participationEnabled: true, sellerPreferenceAllowedInstallments: [1, 6], expectedVersion: 1, reason: "Seller QA preference" }, prisma);
  assert.equal(preferred.version, 2);
  assert.deepEqual(preferred.sellerPreferenceAllowedInstallments, [1, 6]);
  const auditsBeforeFailures = await prisma.sellerInstallmentControlAudit.count({ where: { controlId: created.id } });
  await assert.rejects(() => setOwnSellerInstallmentPreference({ actorUserId: sellerAUser.id, controlId: created.id, participationEnabled: true, sellerPreferenceAllowedInstallments: [1, 9], expectedVersion: 2, reason: "Outside delegation" }, prisma), codeIs("PREFERENCE_OUTSIDE_DELEGATION"));
  await assert.rejects(() => setOwnSellerInstallmentPreference({ actorUserId: sellerBUser.id, controlId: created.id, participationEnabled: true, sellerPreferenceAllowedInstallments: [1], expectedVersion: 2, reason: "Foreign mutation" }, prisma), codeIs("CONTROL_NOT_FOUND"));
  await assert.rejects(() => setOwnSellerInstallmentPreference({ actorUserId: sellerAUser.id, controlId: created.id, participationEnabled: false, sellerPreferenceAllowedInstallments: [1], expectedVersion: 1, reason: "Stale mutation" }, prisma), codeIs("STALE_VERSION"));
  assert.equal(await prisma.sellerInstallmentControlAudit.count({ where: { controlId: created.id } }), auditsBeforeFailures, "failed mutations must not create success audit evidence");

  const narrowed = await setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: sellerA.id, authorizationMode: "DELEGATED", delegatedAllowedInstallments: [1, 3], expectedVersion: 2, reason: "Narrow QA delegation" }, prisma);
  assert.equal(narrowed.conflictReason, "PREFERENCE_OUTSIDE_DELEGATION");
  assert.deepEqual(narrowed.sellerPreferenceAllowedInstallments, [1, 6], "delegation reduction silently rewrote seller preference");
  assert.deepEqual((await getSellerInstallmentControl(sellerA.id, prisma)).effectiveAllowedInstallments, [1]);

  const repaired = await setOwnSellerInstallmentPreference({ actorUserId: sellerAUser.id, controlId: created.id, participationEnabled: true, sellerPreferenceAllowedInstallments: [1, 3], expectedVersion: 3, reason: "Repair QA preference" }, prisma);
  const concurrent = await Promise.allSettled([
    setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: sellerA.id, authorizationMode: "DISABLED", delegatedAllowedInstallments: [1], expectedVersion: repaired.version, reason: "Concurrent admin revoke" }, prisma),
    setOwnSellerInstallmentPreference({ actorUserId: sellerAUser.id, controlId: created.id, participationEnabled: false, sellerPreferenceAllowedInstallments: [1], expectedVersion: repaired.version, reason: "Concurrent seller opt out" }, prisma),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "exactly one concurrent mutation must succeed");
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1, "one concurrent mutation must fail closed");

  const current = await prisma.sellerInstallmentControl.findUniqueOrThrow({ where: { id: created.id } });
  const revoked = current.authorizationMode === "DISABLED" ? current : await setSellerInstallmentAuthorization({ actorUserId: admin.id, sellerId: sellerA.id, authorizationMode: "DISABLED", delegatedAllowedInstallments: [1], expectedVersion: current.version, reason: "Final QA revoke" }, prisma);
  assert.deepEqual(evaluateSellerInstallmentControl(revoked).effectiveAllowedInstallments, [1]);
  const historicalAfterRevoke = await prisma.order.findUniqueOrThrow({ where: { id: historicalOrder.id }, include: { payment: true } });
  assert.deepEqual({ orderTotal: historicalAfterRevoke.totalAmount.toString(), selectedInstallmentCount: historicalAfterRevoke.payment!.selectedInstallmentCount, policyReference: historicalAfterRevoke.payment!.installmentPolicyReference }, historicalSnapshot, "authorization revoke mutated historical Order/Payment truth");

  const audits = await prisma.sellerInstallmentControlAudit.findMany({ where: { controlId: created.id }, orderBy: { createdAt: "asc" } });
  assert(audits.some((audit) => audit.actorRole === "ADMIN" && audit.action.startsWith("AUTHORIZATION_")));
  assert(audits.some((audit) => audit.actorRole === "SELLER" && audit.action === "SELLER_PREFERENCE_UPDATED"));
  assert(audits.every((audit) => audit.newState && audit.newVersion >= 1 && audit.reason.length >= 3));
  assert.equal(audits.length, current.version === revoked.version ? current.version : revoked.version, "each successful version must have one audit event");
  console.log("PASS: #24 Slice B guarded TEST DB authority, IDOR, stale CAS, real concurrency, conflict and atomic audit scenarios");
}

main().finally(async () => { await cleanup(); await prisma.$disconnect(); }).catch((error) => { console.error(error); process.exitCode = 1; });
