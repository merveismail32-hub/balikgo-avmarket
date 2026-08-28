import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { assertPaymentPaidForFulfillment } from "./order-orchestrator";

const SHIPMENT_ELIGIBLE_ITEM_STATUSES = ["NEW", "PREPARING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

export async function createSellerShipment(input: { orderId: string; sellerId: string; orderItemIds?: string[] }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    await assertPaymentPaidForFulfillment(tx, input.orderId);
    const selectedIds = input.orderItemIds?.toSorted();
    const idempotencyKey = selectedIds
      ? `split:${input.orderId}:${input.sellerId}:${createHash("sha256").update(selectedIds.join(":"), "utf8").digest("hex")}`
      : `default:${input.orderId}:${input.sellerId}`;
    const existing = await tx.shipment.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } });
    if (existing) return existing;
    const items = await tx.orderItem.findMany({
      where: {
        orderId: input.orderId,
        sellerId: input.sellerId,
        status: { in: [...SHIPMENT_ELIGIBLE_ITEM_STATUSES] },
        ...(selectedIds ? { id: { in: selectedIds } } : {}),
        shipmentItems: { none: {} },
      },
      select: { id: true, quantity: true, status: true },
    });
    if (selectedIds && items.length !== selectedIds.length) return null;
    if (!items.length) return null;
    const status = items.every((item) => item.status === "DELIVERED" || item.status === "COMPLETED")
      ? "DELIVERED"
      : items.some((item) => item.status === "SHIPPED")
        ? "SHIPPED"
        : items.some((item) => item.status === "READY_TO_SHIP")
          ? "READY_TO_SHIP"
          : items.some((item) => item.status === "PREPARING")
            ? "PREPARING"
            : "NOT_READY";
    return tx.shipment.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        orderId: input.orderId,
        sellerId: input.sellerId,
        idempotencyKey,
        status,
        items: { create: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) },
        events: { create: { source: "SYSTEM", externalEventId: "shipment-created", status, eventTime: new Date(), applied: true } },
      },
      select: { id: true, status: true },
    });
  });
}
