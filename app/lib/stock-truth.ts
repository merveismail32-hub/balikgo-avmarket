import "server-only";

import { Prisma, type StockMovement, type StockMovementType } from "@prisma/client";

export type StockTruthCode = "INSUFFICIENT_STOCK" | "STALE_INVENTORY_VERSION" | "IDEMPOTENCY_CONFLICT" | "OFFER_NOT_FOUND" | "OWNERSHIP_MISMATCH" | "INVALID_QUANTITY";
export class StockTruthError extends Error { constructor(public readonly code: StockTruthCode) { super(code); } }
type Result = { stock: number; inventoryVersion: number; movement: StockMovement | null; replay: boolean; noChange: boolean };
type Base = { sellerOfferId: string; productId: string; idempotencyKey: string; source: string; actorUserId?: string; actorSellerId?: string; orderId?: string; orderItemId?: string; paymentId?: string; refundId?: string };

async function lockKey(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function replay(tx: Prisma.TransactionClient, input: Base, type: StockMovementType, delta: number) {
  await lockKey(tx, input.idempotencyKey);
  const movement = await tx.stockMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!movement) return null;
  if (movement.sellerOfferId !== input.sellerOfferId || movement.productId !== input.productId || movement.type !== type || movement.quantityDelta !== delta || movement.source !== input.source || movement.orderId !== (input.orderId ?? null) || movement.orderItemId !== (input.orderItemId ?? null) || movement.paymentId !== (input.paymentId ?? null) || movement.refundId !== (input.refundId ?? null) || movement.actorSellerId !== (input.actorSellerId ?? null)) throw new StockTruthError("IDEMPOTENCY_CONFLICT");
  return { stock: movement.stockAfter, inventoryVersion: movement.inventoryVersionAfter, movement, replay: true, noChange: false } satisfies Result;
}

async function finish(tx: Prisma.TransactionClient, input: Base, type: StockMovementType, before: number, after: number, versionBefore: number) {
  await tx.product.update({ where: { id: input.productId }, data: { stock: after } });
  const movement = await tx.stockMovement.create({ data: { sellerOfferId: input.sellerOfferId, productId: input.productId, orderId: input.orderId, orderItemId: input.orderItemId, paymentId: input.paymentId, refundId: input.refundId, actorUserId: input.actorUserId, actorSellerId: input.actorSellerId, type, quantityDelta: after - before, stockBefore: before, stockAfter: after, inventoryVersionBefore: versionBefore, inventoryVersionAfter: versionBefore + 1, idempotencyKey: input.idempotencyKey, source: input.source } });
  return { stock: after, inventoryVersion: versionBefore + 1, movement, replay: false, noChange: false } satisfies Result;
}

export async function decrementForCheckout(tx: Prisma.TransactionClient, input: Base & { quantity: number; sellerId: string }) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new StockTruthError("INVALID_QUANTITY");
  const prior = await replay(tx, input, "CHECKOUT_DECREMENT", -input.quantity); if (prior) return prior;
  const rows = await tx.$queryRaw<Array<{ stock: number; inventoryVersion: number }>>`UPDATE "SellerOffer" SET stock=stock-${input.quantity}, "inventoryVersion"="inventoryVersion"+1, "updatedAt"=NOW() WHERE id=${input.sellerOfferId} AND "sellerId"=${input.sellerId} AND active=true AND stock>=${input.quantity} RETURNING stock, "inventoryVersion"`;
  if (!rows[0]) { const exists = await tx.sellerOffer.findUnique({ where: { id: input.sellerOfferId }, select: { sellerId: true, stock: true } }); if (!exists) throw new StockTruthError("OFFER_NOT_FOUND"); if (exists.sellerId !== input.sellerId) throw new StockTruthError("OWNERSHIP_MISMATCH"); throw new StockTruthError("INSUFFICIENT_STOCK"); }
  return finish(tx, input, "CHECKOUT_DECREMENT", rows[0].stock + input.quantity, rows[0].stock, rows[0].inventoryVersion - 1);
}

export async function restoreCancellation(tx: Prisma.TransactionClient, input: Base & { quantity: number }) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new StockTruthError("INVALID_QUANTITY");
  const prior = await replay(tx, input, "CANCELLATION_RESTORE", input.quantity); if (prior) return prior;
  const rows = await tx.$queryRaw<Array<{ stock: number; inventoryVersion: number }>>`UPDATE "SellerOffer" SET stock=stock+${input.quantity}, "inventoryVersion"="inventoryVersion"+1, "updatedAt"=NOW() WHERE id=${input.sellerOfferId} RETURNING stock, "inventoryVersion"`;
  if (!rows[0]) throw new StockTruthError("OFFER_NOT_FOUND");
  return finish(tx, input, "CANCELLATION_RESTORE", rows[0].stock - input.quantity, rows[0].stock, rows[0].inventoryVersion - 1);
}

export async function setSellerAbsoluteStock(tx: Prisma.TransactionClient, input: Base & { sellerId: string; expectedVersion: number; quantity: number }) {
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new StockTruthError("INVALID_QUANTITY");
  await lockKey(tx, input.idempotencyKey);
  const existing = await tx.stockMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.sellerOfferId !== input.sellerOfferId || existing.productId !== input.productId || existing.type !== "SELLER_ABSOLUTE_SET" || existing.stockAfter !== input.quantity || existing.inventoryVersionBefore !== input.expectedVersion || existing.source !== input.source || existing.actorSellerId !== (input.actorSellerId ?? null)) throw new StockTruthError("IDEMPOTENCY_CONFLICT");
    return { stock: existing.stockAfter, inventoryVersion: existing.inventoryVersionAfter, movement: existing, replay: true, noChange: false } satisfies Result;
  }
  const current = await tx.sellerOffer.findFirst({ where: { id: input.sellerOfferId, sellerId: input.sellerId }, select: { stock: true, inventoryVersion: true } });
  if (!current) throw new StockTruthError("OFFER_NOT_FOUND");
  if (current.inventoryVersion !== input.expectedVersion) throw new StockTruthError("STALE_INVENTORY_VERSION");
  if (current.stock === input.quantity) return { stock: current.stock, inventoryVersion: current.inventoryVersion, movement: null, replay: false, noChange: true } satisfies Result;
  const rows = await tx.$queryRaw<Array<{ stock: number; inventoryVersion: number }>>`UPDATE "SellerOffer" SET stock=${input.quantity}, "inventoryVersion"="inventoryVersion"+1, "updatedAt"=NOW() WHERE id=${input.sellerOfferId} AND "sellerId"=${input.sellerId} AND "inventoryVersion"=${input.expectedVersion} RETURNING stock, "inventoryVersion"`;
  if (!rows[0]) throw new StockTruthError("STALE_INVENTORY_VERSION");
  return finish(tx, input, "SELLER_ABSOLUTE_SET", current.stock, rows[0].stock, input.expectedVersion);
}
