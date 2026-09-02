import "dotenv/config";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";

const testEnv = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: testEnv.DATABASE_URL, SUPABASE_CA_CERT_PATH: testEnv.SUPABASE_CA_CERT_PATH });
const rollback = new Error("ROLLBACK_FINANCE_QA");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function counts() { return { orders: await prisma.order.count(), items: await prisma.orderItem.count(), payments: await prisma.payment.count(), payouts: await prisma.sellerPayout.count(), refunds: await prisma.refund.count(), events: await prisma.paymentEvent.count(), notifications: await prisma.notification.count() }; }

async function main() {
  const before = await counts();
  try {
    await prisma.$transaction(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 10); const passwordHash = "transaction-only-not-a-login";
      const sellerAUser = await tx.user.create({ data: { name: "QA", surname: "Seller A", email: `finance-a-${suffix}@invalid.local`, phone: "000", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: `Finance A ${suffix}`, storeSlug: `finance-a-${suffix}`, companyType: "TEST", taxNumber: `A-${suffix}`, taxOffice: "Test", city: "Test", address: "Transaction only", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
      const sellerBUser = await tx.user.create({ data: { name: "QA", surname: "Seller B", email: `finance-b-${suffix}@invalid.local`, phone: "000", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: `Finance B ${suffix}`, storeSlug: `finance-b-${suffix}`, companyType: "TEST", taxNumber: `B-${suffix}`, taxOffice: "Test", city: "Test", address: "Transaction only", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
      const customer = await tx.user.create({ data: { name: "QA", surname: "Customer", email: `finance-c-${suffix}@invalid.local`, phone: "000", passwordHash } });
      const productA = await tx.product.create({ data: { sellerId: sellerAUser.sellerProfile!.id, name: "Finance Product A", slug: `finance-product-a-${suffix}`, category: "QA", brand: "QA", price: "100.00", stock: 1, description: "Transaction-only finance QA product", imageUrl: "/products/olta-makinesi.jpg" } });
      const productB = await tx.product.create({ data: { sellerId: sellerBUser.sellerProfile!.id, name: "Finance Product B", slug: `finance-product-b-${suffix}`, category: "QA", brand: "QA", price: "50.00", stock: 1, description: "Transaction-only finance QA product", imageUrl: "/products/olta-makinesi.jpg" } });
      const rate = new Prisma.Decimal("0.10"); const grossA = productA.price.mul(2); const commissionA = grossA.mul(rate).toDecimalPlaces(2); const netA = grossA.minus(commissionA);
      assert(grossA.equals(200) && commissionA.equals(20) && netA.equals(180), "Decimal commission invariant failed");
      const order = await tx.order.create({ data: { userId: customer.id, orderNumber: `FIN-${suffix}`, clientRequestId: crypto.randomUUID(), totalAmount: grossA.add(productB.price), recipientName: "QA Customer", phone: "000", city: "Test", district: "Test", address: "Transaction-only address", items: { create: [{ productId: productA.id, sellerId: sellerAUser.sellerProfile!.id, productName: productA.name, productImageUrl: productA.imageUrl, unitPrice: productA.price, quantity: 2, commissionRate: rate, commissionAmount: commissionA, sellerNetAmount: netA }, { productId: productB.id, sellerId: sellerBUser.sellerProfile!.id, productName: productB.name, productImageUrl: productB.imageUrl, unitPrice: productB.price, quantity: 1, commissionRate: rate, commissionAmount: productB.price.mul(rate), sellerNetAmount: productB.price.mul(new Prisma.Decimal("0.90")) }] } }, include: { items: true } });
      const payment = await tx.payment.create({ data: { orderId: order.id, amount: order.totalAmount, idempotencyKey: `qa:${suffix}`, provider: "TEST_PENDING" } });
      for (const item of order.items) await tx.sellerPayout.create({ data: { sellerId: item.sellerId, orderId: order.id, orderItemId: item.id, grossAmount: item.unitPrice.mul(item.quantity), commissionAmount: item.commissionAmount!, netAmount: item.sellerNetAmount! } });
      assert(await tx.sellerPayout.count({ where: { sellerId: sellerAUser.sellerProfile!.id } }) === 1, "Seller A payout isolation failed");
      assert(await tx.sellerPayout.count({ where: { sellerId: sellerBUser.sellerProfile!.id } }) === 1, "Seller B payout isolation failed");
      assert(await tx.order.count({ where: { id: order.id, userId: customer.id } }) === 1, "Customer ownership failed");
      const refund = await tx.refund.create({ data: { paymentId: payment.id, orderId: order.id, orderItemId: order.items[0].id, sellerId: sellerAUser.sellerProfile!.id, requestedByUserId: customer.id, idempotencyKey: `return:${order.items[0].id}`, amount: grossA, reason: "Transaction-only valid return reason" } });
      await tx.notification.createMany({ data: [{ userId: customer.id, orderId: order.id, type: "PAYMENT_PAID", dedupeKey: `qa:${suffix}:customer`, title: "QA", message: "Customer-only" }, { sellerId: sellerAUser.sellerProfile!.id, orderId: order.id, type: "SELLER_NEW_ORDER", dedupeKey: `qa:${suffix}:seller-a`, title: "QA", message: "Seller A only" }] });
      assert(await tx.refund.count({ where: { id: refund.id, order: { userId: customer.id } } }) === 1, "Refund customer ownership failed");
      assert(await tx.refund.count({ where: { id: refund.id, sellerId: sellerBUser.sellerProfile!.id } }) === 0, "Refund seller isolation failed");
      assert(await tx.notification.count({ where: { sellerId: sellerBUser.sellerProfile!.id } }) === 0, "Notification seller isolation failed");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  const after = await counts();
  assert(JSON.stringify(before) === JSON.stringify(after), `Permanent test data detected: ${JSON.stringify({ before, after })}`);
  console.log("PASS: Decimal commission, multi-seller payout isolation, customer/refund ownership, notification isolation and transaction rollback.");
}
main().finally(() => prisma.$disconnect());
