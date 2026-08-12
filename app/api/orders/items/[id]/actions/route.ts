import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { enqueueNotifications } from "@/app/lib/notifications";
import type { OrderStatus } from "@prisma/client";

function aggregate(statuses: OrderStatus[]): OrderStatus { const active = statuses.filter((status) => status !== "CANCELLED"); if (!active.length) return "CANCELLED"; if (active.some((status) => status === "RETURN_REQUESTED")) return "RETURN_REQUESTED"; if (active.every((status) => status === "RETURNED")) return "RETURNED"; if (active.every((status) => status === "DELIVERED" || status === "COMPLETED")) return "DELIVERED"; if (active.some((status) => ["SHIPPED", "DELIVERED", "COMPLETED"].includes(status))) return "SHIPPED"; if (active.some((status) => status === "READY_TO_SHIP")) return "READY_TO_SHIP"; if (active.some((status) => status === "PREPARING")) return "PREPARING"; return "NEW"; }

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CANCEL") }).strict(),
  z.object({ action: z.literal("REQUEST_RETURN"), reason: z.string().trim().min(10).max(500) }).strict(),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz işlem." }, { status: 400 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({ where: { id, order: { userId: session.user.id } }, select: { id: true, orderId: true, sellerId: true, productId: true, sellerOfferId: true, productName: true, quantity: true, unitPrice: true, status: true, order: { select: { orderNumber: true, payment: { select: { id: true } } } } } });
      if (!item) return null;
      if (parsed.data.action === "CANCEL") {
        if (item.status === "CANCELLED") return { status: "CANCELLED", idempotent: true };
        if (item.status !== "NEW" && item.status !== "PREPARING") throw new Error("INVALID_STATE");
        const changed = await tx.orderItem.updateMany({ where: { id: item.id, status: item.status, order: { userId: session.user.id } }, data: { status: "CANCELLED" } });
        if (!changed.count) throw new Error("CONCURRENT_CHANGE");
        if (item.sellerOfferId) {
          const offer = await tx.sellerOffer.update({ where: { id: item.sellerOfferId }, data: { stock: { increment: item.quantity } }, select: { stock: true } });
          await tx.product.update({ where: { id: item.productId }, data: { stock: offer.stock } });
        } else {
          await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        }
        await tx.sellerPayout.updateMany({ where: { orderItemId: item.id, status: { in: ["PENDING", "BLOCKED", "AVAILABLE", "SCHEDULED"] } }, data: { status: "CANCELLED" } });
        await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: session.user.id, fromStatus: item.status, toStatus: "CANCELLED" } });
        await tx.financialAuditEvent.create({ data: { paymentId: item.order.payment?.id, orderId: item.orderId, actorUserId: session.user.id, entityType: "ORDER_ITEM", entityId: item.id, eventType: "CUSTOMER_CANCELLED", fromStatus: item.status, toStatus: "CANCELLED", source: "CUSTOMER" } });
        await enqueueNotifications(tx, [{ sellerId: item.sellerId, orderId: item.orderId, type: "ORDER_CANCELLED", dedupeKey: `customer-cancel:${item.id}:seller`, title: "Sipariş kalemi iptal edildi", message: `${item.order.orderNumber} siparişindeki ${item.productName} müşteri tarafından iptal edildi.` }]);
        const statuses = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } }); await tx.order.update({ where: { id: item.orderId }, data: { status: aggregate(statuses.map((entry) => entry.status)) } });
        return { status: "CANCELLED", idempotent: false };
      }
      if (item.status === "RETURN_REQUESTED") return { status: "RETURN_REQUESTED", idempotent: true };
      if (item.status !== "DELIVERED" && item.status !== "COMPLETED") throw new Error("INVALID_STATE");
      if (!item.order.payment) throw new Error("PAYMENT_NOT_FOUND");
      const refund = await tx.refund.upsert({ where: { idempotencyKey: `return:${item.id}` }, update: {}, create: { paymentId: item.order.payment.id, orderId: item.orderId, orderItemId: item.id, sellerId: item.sellerId, requestedByUserId: session.user.id, idempotencyKey: `return:${item.id}`, amount: item.unitPrice.mul(item.quantity), reason: parsed.data.reason } });
      const changed = await tx.orderItem.updateMany({ where: { id: item.id, status: { in: ["DELIVERED", "COMPLETED"] }, order: { userId: session.user.id } }, data: { status: "RETURN_REQUESTED" } });
      if (changed.count) {
        await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: session.user.id, fromStatus: item.status, toStatus: "RETURN_REQUESTED" } });
        await tx.sellerPayout.updateMany({ where: { orderItemId: item.id, status: { in: ["PENDING", "AVAILABLE", "SCHEDULED"] } }, data: { status: "BLOCKED" } });
        await tx.financialAuditEvent.create({ data: { paymentId: item.order.payment.id, refundId: refund.id, orderId: item.orderId, actorUserId: session.user.id, entityType: "REFUND", entityId: refund.id, eventType: "RETURN_REQUESTED", toStatus: "REQUESTED", source: "CUSTOMER" } });
        await enqueueNotifications(tx, [{ sellerId: item.sellerId, orderId: item.orderId, type: "RETURN_REQUESTED", dedupeKey: `return-request:${refund.id}:seller`, title: "İade talebi", message: `${item.order.orderNumber} siparişindeki ${item.productName} için iade talebi oluşturuldu.` }]);
        const statuses = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } }); await tx.order.update({ where: { id: item.orderId }, data: { status: aggregate(statuses.map((entry) => entry.status)) } });
      }
      return { status: "RETURN_REQUESTED", idempotent: !changed.count };
    });
    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "Sipariş kalemi bulunamadı." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INVALID_STATE" || message === "CONCURRENT_CHANGE") return NextResponse.json({ error: "Bu sipariş kalemi mevcut durumunda bu işlem için uygun değil." }, { status: 409 });
    if (message === "PAYMENT_NOT_FOUND") return NextResponse.json({ error: "Bu sipariş için ödeme kaydı bulunamadı." }, { status: 409 });
    console.error("[customer-order-action] failed", { orderItemId: id, code: (error as { code?: string }).code });
    return NextResponse.json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, { status: 500 });
  }
}
