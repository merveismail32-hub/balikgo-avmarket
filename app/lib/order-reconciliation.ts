import "server-only";

import { Prisma } from "@prisma/client";
import { aggregateOrderStatus } from "./order-invariants";

export async function reconcileOrderAggregate(tx: Prisma.TransactionClient, orderId: string) {
  const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (!locked.length) throw new Error("ORDER_NOT_FOUND");
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { status: true } });
  if (!items.length) throw new Error("ORDER_ITEMS_NOT_FOUND");
  const status = aggregateOrderStatus(items.map((item) => item.status));
  if (locked[0].status === status) return { status, changed: false };
  await tx.order.update({ where: { id: orderId }, data: { status } });
  return { status, changed: true };
}
