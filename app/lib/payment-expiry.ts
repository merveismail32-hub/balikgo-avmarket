import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { enqueueNotifications } from "./notifications";
import { createOrGetPaymentReconciliationReview, enqueuePaymentReconciliationAlerts } from "./payment-reconciliation";
import { releaseOrderReservation } from "./stock-reservation";

export const PAYMENT_EXPIRY_BATCH_MAX = 25;
export const PAYMENT_EXPIRY_LEASE_MS = 5 * 60_000;

type Claim = { id: string; expiryClaimToken: string };
type TransactionHost = Pick<PrismaClient, "$transaction">;

export async function claimExpiredPayments(client: TransactionHost, input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? PAYMENT_EXPIRY_BATCH_MAX), 1), PAYMENT_EXPIRY_BATCH_MAX);
  const leaseExpiresAt = new Date(now.getTime() + PAYMENT_EXPIRY_LEASE_MS);
  return client.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Payment"
      WHERE "status" IN ('PENDING', 'AUTHORIZED')
        AND "reservationExpiresAt" <= ${now}
        AND ("expiryClaimExpiresAt" IS NULL OR "expiryClaimExpiresAt" <= ${now})
      ORDER BY "reservationExpiresAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);
    const claims: Claim[] = [];
    for (const candidate of candidates) {
      const token = randomBytes(32).toString("hex");
      const changed = await tx.payment.updateMany({ where: { id: candidate.id, status: { in: ["PENDING", "AUTHORIZED"] }, reservationExpiresAt: { lte: now }, OR: [{ expiryClaimExpiresAt: null }, { expiryClaimExpiresAt: { lte: now } }] }, data: { expiryClaimToken: token, expiryClaimedAt: now, expiryClaimExpiresAt: leaseExpiresAt } });
      if (changed.count) claims.push({ id: candidate.id, expiryClaimToken: token });
    }
    return claims;
  });
}

export async function expireClaimedPayment(tx: Prisma.TransactionClient, claim: Claim, now = new Date()) {
  const payment = await tx.payment.findFirst({ where: { id: claim.id, expiryClaimToken: claim.expiryClaimToken }, select: { id: true, orderId: true, status: true, reservationExpiresAt: true, expiryClaimExpiresAt: true, order: { select: { userId: true, orderNumber: true, items: { select: { id: true, status: true, stockReservationState: true, shipmentItems: { select: { id: true }, take: 1 } } } } } } });
  if (!payment || !["PENDING", "AUTHORIZED"].includes(payment.status) || !payment.reservationExpiresAt || payment.reservationExpiresAt > now || !payment.expiryClaimExpiresAt || payment.expiryClaimExpiresAt <= now) return { outcome: "skipped" as const };
  const fulfillmentConflict = payment.order.items.some((item) => !["NEW", "CANCELLED"].includes(item.status) || item.shipmentItems.length > 0);
  if (fulfillmentConflict) {
    const review = await createOrGetPaymentReconciliationReview(tx, { paymentId: payment.id, reason: "EXPIRY_FULFILLMENT_CONFLICT", terminalStatus: payment.status, priority: "CRITICAL", metadata: { signal: "REFUND_REQUIRED", slaHours: 2 } });
    await tx.financialAuditEvent.create({ data: { paymentId: payment.id, orderId: payment.orderId, entityType: "PAYMENT", entityId: payment.id, eventType: "EXPIRY_FULFILLMENT_CONFLICT", fromStatus: payment.status, toStatus: payment.status, source: "EXPIRY_WORKER" } });
    await enqueuePaymentReconciliationAlerts(tx, { reviewId: review.review.id, orderId: payment.orderId, type: "EXPIRY_FULFILLMENT_CONFLICT", title: "Kritik stok uzlaşma incelemesi", message: "Süresi dolan ödeme fulfillment ile çakıştı; iki saat içinde inceleme gereklidir." });
    await tx.payment.update({ where: { id: payment.id }, data: { expiryClaimToken: null, expiryClaimedAt: null, expiryClaimExpiresAt: null } });
    return { outcome: "skipped" as const };
  }
  if (payment.order.items.some((item) => item.stockReservationState !== "RESERVED")) {
    const review = await createOrGetPaymentReconciliationReview(tx, { paymentId: payment.id, reason: "PAYMENT_STOCK_STATE_MISMATCH", terminalStatus: payment.status, priority: "CRITICAL", metadata: { signal: "REFUND_REQUIRED", slaHours: 2 } });
    await enqueuePaymentReconciliationAlerts(tx, { reviewId: review.review.id, orderId: payment.orderId, type: "PAYMENT_STOCK_STATE_MISMATCH", title: "Kritik ödeme-stok uyumsuzluğu", message: "Ödeme ve stok rezervasyon durumu uyuşmuyor; iki saat içinde inceleme gereklidir." });
    await tx.payment.update({ where: { id: payment.id }, data: { expiryClaimToken: null, expiryClaimedAt: null, expiryClaimExpiresAt: null } });
    return { outcome: "skipped" as const };
  }
  const changed = await tx.payment.updateMany({ where: { id: payment.id, expiryClaimToken: claim.expiryClaimToken, status: { in: ["PENDING", "AUTHORIZED"] }, reservationExpiresAt: { lte: now }, expiryClaimExpiresAt: { gt: now } }, data: { status: "EXPIRED", expiredAt: now } });
  if (!changed.count) return { outcome: "skipped" as const };
  await releaseOrderReservation(tx, { paymentId: payment.id, reason: "PAYMENT_EXPIRED" });
  await tx.payment.update({ where: { id: payment.id }, data: { stockReleasedAt: now, stockReleaseReason: "PAYMENT_EXPIRED", expiryClaimToken: null, expiryClaimedAt: null, expiryClaimExpiresAt: null } });
  await tx.financialAuditEvent.create({ data: { paymentId: payment.id, orderId: payment.orderId, entityType: "PAYMENT", entityId: payment.id, eventType: "PAYMENT_EXPIRED", fromStatus: payment.status, toStatus: "EXPIRED", source: "EXPIRY_WORKER" } });
  await enqueueNotifications(tx, [{ userId: payment.order.userId, orderId: payment.orderId, type: "PAYMENT_EXPIRED", dedupeKey: `payment-expired:${payment.id}:customer`, title: "Ödeme süresi doldu", message: `${payment.order.orderNumber} numaralı siparişiniz ödeme süresi dolduğu için iptal edildi.` }]);
  return { outcome: "expired" as const };
}

export async function runPaymentExpiryBatch(client: PrismaClient, input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  const claims = await claimExpiredPayments(client, { now, limit: input.limit });
  const result = { claimed: claims.length, expired: 0, skipped: 0, failed: 0 };
  for (const claim of claims) {
    try {
      const item = await client.$transaction((tx) => expireClaimedPayment(tx, claim, now));
      result[item.outcome]++;
    } catch {
      result.failed++;
      await client.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({ where: { id: claim.id, expiryClaimToken: claim.expiryClaimToken }, select: { id: true, status: true } });
        if (payment) await createOrGetPaymentReconciliationReview(tx, { paymentId: payment.id, reason: "EXPIRY_RELEASE_FAILED", terminalStatus: payment.status, priority: "CRITICAL", metadata: { signal: "REFUND_REQUIRED", slaHours: 2 } });
      }).catch(() => undefined);
    }
  }
  return result;
}
