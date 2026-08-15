import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { assertPaymentPaidForFulfillment } from "@/app/lib/order-orchestrator";

const schema = z.object({ orderId: z.string().cuid() }).strict();

export async function POST(request: Request) {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sipariş." }, { status: 400 });
  try {
    const shipment = await prisma.$transaction(async (tx) => {
      await assertPaymentPaidForFulfillment(tx, parsed.data.orderId);
      const items = await tx.orderItem.findMany({ where: { orderId: parsed.data.orderId, sellerId: seller.id, status: { not: "CANCELLED" } }, select: { id: true, quantity: true, status: true } });
      if (!items.length) return null;
      const idempotencyKey = `default:${parsed.data.orderId}:${seller.id}`;
      const status = items.every((item) => item.status === "DELIVERED" || item.status === "COMPLETED") ? "DELIVERED" : items.some((item) => item.status === "SHIPPED") ? "SHIPPED" : items.some((item) => item.status === "READY_TO_SHIP") ? "READY_TO_SHIP" : items.some((item) => item.status === "PREPARING") ? "PREPARING" : "NOT_READY";
      return tx.shipment.upsert({ where: { idempotencyKey }, update: {}, create: { orderId: parsed.data.orderId, sellerId: seller.id, idempotencyKey, status, items: { create: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) } }, select: { id: true, status: true } });
    });
    return shipment ? NextResponse.json(shipment, { status: 201 }) : NextResponse.json({ error: "Paketlenebilir sipariş kalemi bulunamadı." }, { status: 404 });
  } catch (error) { if (error instanceof Error && error.message === "PAYMENT_NOT_PAID") return NextResponse.json({ error: "Ödeme tamamlanmadan paket oluşturulamaz." }, { status: 409 }); throw error; }
}
