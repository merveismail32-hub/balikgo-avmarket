import "server-only";

import { Prisma, type StockReleaseReason } from "@prisma/client";
import { releaseReservationStock } from "./stock-truth";
import { cancellationLedgerReversals } from "./order-invariants";
import { reconcileOrderAggregate } from "./order-reconciliation";

export class StockReservationError extends Error {
  constructor(public readonly code: "RESERVATION_CONFLICT" | "RESERVATION_NOT_FOUND" | "PAYMENT_NOT_PAID") { super(code); }
}

export const reservationReleaseKey = (orderItemId: string) => `stock:v2:reservation-release:${orderItemId}`;

export async function consumeOrderReservationsForPayment(tx: Prisma.TransactionClient, paymentId: string) {
  const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { orderId: true, order: { select: { items: { select: { id: true, stockReservationState: true, stockReservationVersion: true } } } } } });
  if (!payment) throw new StockReservationError("RESERVATION_NOT_FOUND");
  for (const item of payment.order.items) {
    if (item.stockReservationState === null) continue;
    if (item.stockReservationState === "CONSUMED") continue;
    if (item.stockReservationState !== "RESERVED") throw new StockReservationError("RESERVATION_CONFLICT");
    const changed = await tx.orderItem.updateMany({ where: { id: item.id, stockReservationState: "RESERVED", stockReservationVersion: item.stockReservationVersion }, data: { stockReservationState: "CONSUMED", stockReservationVersion: { increment: 1 } } });
    if (!changed.count) throw new StockReservationError("RESERVATION_CONFLICT");
  }
}

export async function releaseOrderItemReservation(tx: Prisma.TransactionClient, input: { orderItemId: string; reason: StockReleaseReason; allowConsumed: boolean; actorUserId?: string; actorSellerId?: string }) {
  const item = await tx.orderItem.findUnique({ where: { id: input.orderItemId }, select: { id: true, orderId: true, productId: true, sellerOfferId: true, quantity: true, stockReservationState: true, stockReservationVersion: true, stockReservationReleaseReason: true } });
  if (!item) throw new StockReservationError("RESERVATION_NOT_FOUND");
  if (item.stockReservationState === "RELEASED") return { released: false, legacy: false, reason: item.stockReservationReleaseReason };
  const legacy = item.stockReservationState === null;
  const allowed = legacy || item.stockReservationState === "RESERVED" || (input.allowConsumed && item.stockReservationState === "CONSUMED");
  if (!allowed) throw new StockReservationError("RESERVATION_CONFLICT");
  const now = new Date();
  const changed = await tx.orderItem.updateMany({ where: { id: item.id, stockReservationState: item.stockReservationState, stockReservationVersion: item.stockReservationVersion }, data: { stockReservationState: "RELEASED", stockReservationReleasedAt: now, stockReservationReleaseReason: input.reason, stockReservationVersion: { increment: 1 } } });
  if (!changed.count) {
    const current = await tx.orderItem.findUnique({ where: { id: item.id }, select: { stockReservationState: true, stockReservationReleaseReason: true } });
    if (current?.stockReservationState === "RELEASED") return { released: false, legacy: false, reason: current.stockReservationReleaseReason };
    throw new StockReservationError("RESERVATION_CONFLICT");
  }
  if (!item.sellerOfferId) {
    await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
    await tx.financialAuditEvent.upsert({ where: { source_externalEventId: { source: "RESERVATION", externalEventId: `legacy-stock-release:${item.id}` } }, update: {}, create: { orderId: item.orderId, entityType: "ORDER_ITEM", entityId: item.id, eventType: "LEGACY_STOCK_RELEASE_NO_MOVEMENT", source: "RESERVATION", externalEventId: `legacy-stock-release:${item.id}` } });
    return { released: true, legacy: true, reason: input.reason };
  }
  const movement = await releaseReservationStock(tx, { sellerOfferId: item.sellerOfferId, productId: item.productId, quantity: item.quantity, orderId: item.orderId, orderItemId: item.id, actorUserId: input.actorUserId, actorSellerId: input.actorSellerId, idempotencyKey: reservationReleaseKey(item.id), source: input.reason });
  return { released: true, legacy, reason: input.reason, movement };
}

export async function releaseOrderReservation(tx: Prisma.TransactionClient, input: { paymentId: string; reason: "PAYMENT_FAILED" | "PAYMENT_EXPIRED" }) {
  const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { orderId: true, order: { select: { userId: true, couponRedemption: { select: { id: true, couponId: true } }, items: { select: { id: true, sellerId: true, status: true, unitPrice: true, quantity: true, discountAmount: true, commissionAmount: true, stockReservationState: true, payout: { select: { id: true } } } } } } } });
  if (!payment) throw new StockReservationError("RESERVATION_NOT_FOUND");
  for (const item of payment.order.items) {
    const released = await releaseOrderItemReservation(tx, { orderItemId: item.id, reason: input.reason, allowConsumed: false });
    if (!released.released) continue;
    await tx.orderItem.update({ where: { id: item.id }, data: { status: "CANCELLED", statusHistory: { create: { fromStatus: item.status, toStatus: "CANCELLED" } } } });
    await tx.sellerPayout.updateMany({ where: { orderItemId: item.id, status: { in: ["PENDING", "BLOCKED", "AVAILABLE", "SCHEDULED"] } }, data: { status: "CANCELLED", availableAt: null } });
    const gross = item.unitPrice.mul(item.quantity).minus(item.discountAmount).toDecimalPlaces(2);
    await tx.financialLedgerEntry.createMany({ data: cancellationLedgerReversals({ sellerId: item.sellerId, orderItemId: item.id, payoutId: item.payout?.id, grossAmount: gross, commissionAmount: item.commissionAmount ?? new Prisma.Decimal(0), dedupePrefix: "reservation-release" }), skipDuplicates: true });
  }
  if (payment.order.couponRedemption) {
    const removed = await tx.couponRedemption.deleteMany({ where: { id: payment.order.couponRedemption.id, orderId: payment.orderId } });
    if (removed.count) await tx.coupon.updateMany({ where: { id: payment.order.couponRedemption.couponId, usageCount: { gt: 0 } }, data: { usageCount: { decrement: 1 } } });
  }
  await reconcileOrderAggregate(tx, payment.orderId);
  return payment.orderId;
}
