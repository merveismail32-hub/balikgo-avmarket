import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { CARRIERS, SHIPMENT_STATUS_LABELS, SHIPMENT_TRANSITIONS, carrierByCode, shipmentToOrderStatus } from "@/app/lib/shipping";
import { enqueueNotifications } from "@/app/lib/notifications";
import type { OrderStatus, ShipmentStatus } from "@prisma/client";

const schema = z.object({ status: z.enum(["PREPARING", "READY_TO_SHIP", "SHIPPED", "DELIVERED"]), carrierCode: z.enum(CARRIERS.map((carrier) => carrier.code) as [string, ...string[]]).optional(), trackingNumber: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._/-]+$/).optional() }).strict().superRefine((value, context) => {
  if (value.status === "SHIPPED" && (!value.carrierCode || !value.trackingNumber)) context.addIssue({ code: "custom", message: "Kargo firması ve geçerli takip numarası gereklidir." });
  if (value.status !== "SHIPPED" && (value.carrierCode || value.trackingNumber)) context.addIssue({ code: "custom", message: "Kargo bilgileri yalnızca kargoya verme aşamasında gönderilebilir." });
});

function aggregate(statuses: OrderStatus[]): OrderStatus { const active = statuses.filter((status) => status !== "CANCELLED"); if (!active.length) return "CANCELLED"; if (active.every((status) => status === "DELIVERED" || status === "COMPLETED")) return "DELIVERED"; if (active.some((status) => ["SHIPPED", "DELIVERED", "COMPLETED"].includes(status))) return "SHIPPED"; if (active.some((status) => status === "READY_TO_SHIP")) return "READY_TO_SHIP"; if (active.some((status) => status === "PREPARING")) return "PREPARING"; return "NEW"; }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const seller = await getSellerForFulfillment(); if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz gönderi bilgisi." }, { status: 400 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({ where: { id, sellerId: seller.id }, select: { status: true, orderId: true, order: { select: { userId: true, orderNumber: true } }, items: { select: { orderItemId: true, orderItem: { select: { status: true } } } } } });
      if (!shipment) return null;
      const target = parsed.data.status as ShipmentStatus; if (target === shipment.status) return { status: target, idempotent: true }; if (!SHIPMENT_TRANSITIONS[shipment.status].includes(target)) throw new Error("INVALID_TRANSITION");
      const carrier = parsed.data.carrierCode ? carrierByCode(parsed.data.carrierCode) : undefined; const now = new Date();
      const changed = await tx.shipment.updateMany({ where: { id, sellerId: seller.id, status: shipment.status }, data: { status: target, ...(target === "PREPARING" ? { preparedAt: now } : {}), ...(target === "SHIPPED" ? { carrierCode: carrier!.code, carrierName: carrier!.displayName, trackingNumber: parsed.data.trackingNumber, shippedAt: now } : {}), ...(target === "DELIVERED" ? { deliveredAt: now } : {}) } });
      if (!changed.count) throw new Error("CONCURRENT_CHANGE");
      const orderStatus = shipmentToOrderStatus(target);
      for (const item of shipment.items) { if (item.orderItem.status === orderStatus) continue; await tx.orderItem.update({ where: { id: item.orderItemId }, data: { status: orderStatus, ...(target === "SHIPPED" ? { shippingCompany: carrier!.displayName, trackingNumber: parsed.data.trackingNumber } : {}) } }); await tx.orderStatusHistory.create({ data: { orderItemId: item.orderItemId, changedByUserId: seller.userId, fromStatus: item.orderItem.status, toStatus: orderStatus } }); }
      await enqueueNotifications(tx, [{ userId: shipment.order.userId, orderId: shipment.orderId, type: `SHIPMENT_${target}`, dedupeKey: `shipment:${id}:${target}:customer`, title: "Gönderi durumu güncellendi", message: `${shipment.order.orderNumber} siparişinizdeki paket: ${SHIPMENT_STATUS_LABELS[target]}.` }]);
      const statuses = await tx.orderItem.findMany({ where: { orderId: shipment.orderId }, select: { status: true } }); await tx.order.update({ where: { id: shipment.orderId }, data: { status: aggregate(statuses.map((item) => item.status)) } }); return { status: target, idempotent: false };
    });
    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "Paket bulunamadı." }, { status: 404 });
  } catch (error) { const message = error instanceof Error ? error.message : ""; if (["INVALID_TRANSITION", "CONCURRENT_CHANGE"].includes(message)) return NextResponse.json({ error: "Paket durumu bu işlem için uygun değil." }, { status: 409 }); console.error("[seller-shipment] update failed", { shipmentId: id, sellerId: seller.id, code: (error as { code?: string }).code }); return NextResponse.json({ error: "Paket güncellenemedi." }, { status: 500 }); }
}
