import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { assertPaymentPaidForFulfillment } from "@/app/lib/order-orchestrator";

const schema = z.object({ orderId: z.string().cuid(), orderItemIds: z.array(z.string().cuid()).min(1).max(50).optional() }).strict().superRefine((value, context) => { if (value.orderItemIds && new Set(value.orderItemIds).size !== value.orderItemIds.length) context.addIssue({ code: "custom", path: ["orderItemIds"], message: "Sipariş kalemleri benzersiz olmalıdır." }); });

export async function POST(request: Request) {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sipariş." }, { status: 400 });
  try {
    const shipment = await prisma.$transaction(async (tx) => {
      await assertPaymentPaidForFulfillment(tx, parsed.data.orderId);
      const selectedIds = parsed.data.orderItemIds?.toSorted();
      const idempotencyKey = selectedIds ? `split:${parsed.data.orderId}:${seller.id}:${createHash("sha256").update(selectedIds.join(":"), "utf8").digest("hex")}` : `default:${parsed.data.orderId}:${seller.id}`;
      const existing = await tx.shipment.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } });
      if (existing) return existing;
      const items = await tx.orderItem.findMany({ where: { orderId: parsed.data.orderId, sellerId: seller.id, status: { not: "CANCELLED" }, ...(selectedIds ? { id: { in: selectedIds } } : {}), shipmentItems: { none: {} } }, select: { id: true, quantity: true, status: true } });
      if (selectedIds && items.length !== selectedIds.length) return null;
      if (!items.length) return null;
      const status = items.every((item) => item.status === "DELIVERED" || item.status === "COMPLETED") ? "DELIVERED" : items.some((item) => item.status === "SHIPPED") ? "SHIPPED" : items.some((item) => item.status === "READY_TO_SHIP") ? "READY_TO_SHIP" : items.some((item) => item.status === "PREPARING") ? "PREPARING" : "NOT_READY";
      return tx.shipment.upsert({ where: { idempotencyKey }, update: {}, create: { orderId: parsed.data.orderId, sellerId: seller.id, idempotencyKey, status, items: { create: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) }, events: { create: { source: "SYSTEM", externalEventId: "shipment-created", status, eventTime: new Date(), applied: true } } }, select: { id: true, status: true } });
    });
    return shipment ? NextResponse.json(shipment, { status: 201 }) : NextResponse.json({ error: "Paketlenebilir sipariş kalemi bulunamadı." }, { status: 404 });
  } catch (error) { if (error instanceof Error && error.message === "PAYMENT_NOT_PAID") return NextResponse.json({ error: "Ödeme tamamlanmadan paket oluşturulamaz." }, { status: 409 }); throw error; }
}
