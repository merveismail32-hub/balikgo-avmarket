import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

const schema = z.object({ orderId: z.string().cuid() }).strict();

export async function POST(request: Request) {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sipariş." }, { status: 400 });
  const items = await prisma.orderItem.findMany({ where: { orderId: parsed.data.orderId, sellerId: seller.id, status: { not: "CANCELLED" } }, select: { id: true, quantity: true, status: true } });
  if (!items.length) return NextResponse.json({ error: "Paketlenebilir sipariş kalemi bulunamadı." }, { status: 404 });
  const idempotencyKey = `default:${parsed.data.orderId}:${seller.id}`;
  const status = items.every((item) => item.status === "DELIVERED" || item.status === "COMPLETED") ? "DELIVERED" : items.some((item) => item.status === "SHIPPED") ? "SHIPPED" : items.some((item) => item.status === "READY_TO_SHIP") ? "READY_TO_SHIP" : items.some((item) => item.status === "PREPARING") ? "PREPARING" : "NOT_READY";
  const shipment = await prisma.shipment.upsert({ where: { idempotencyKey }, update: {}, create: { orderId: parsed.data.orderId, sellerId: seller.id, idempotencyKey, status, items: { create: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) } }, select: { id: true, status: true } });
  return NextResponse.json(shipment, { status: 201 });
}
