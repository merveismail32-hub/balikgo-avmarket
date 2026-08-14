import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { enqueueNotifications } from "@/app/lib/notifications";
import { aggregateOrderStatus } from "@/app/lib/order-invariants";
import { cancelOrderItem, synchronizePaymentRefundStatus } from "@/app/lib/order-orchestrator";

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
      if (parsed.data.action === "CANCEL") return cancelOrderItem(tx, { orderItemId: id, actor: { kind: "CUSTOMER", userId: session.user.id } });
      const item = await tx.orderItem.findFirst({ where: { id, order: { userId: session.user.id } }, select: { id: true, orderId: true, sellerId: true, productName: true, quantity: true, unitPrice: true, discountAmount: true, status: true, order: { select: { orderNumber: true, payment: { select: { id: true, status: true } } } } } });
      if (!item) return null;
      if (item.status === "RETURN_REQUESTED") return { status: "RETURN_REQUESTED", idempotent: true };
      if (item.status !== "DELIVERED" && item.status !== "COMPLETED") throw new Error("INVALID_STATE");
      if (!item.order.payment) throw new Error("PAYMENT_NOT_FOUND");
      const refund = await tx.refund.upsert({ where: { idempotencyKey: `return:${item.id}` }, update: {}, create: { paymentId: item.order.payment.id, orderId: item.orderId, orderItemId: item.id, sellerId: item.sellerId, requestedByUserId: session.user.id, idempotencyKey: `return:${item.id}`, amount: item.unitPrice.mul(item.quantity).minus(item.discountAmount).toDecimalPlaces(2), reason: parsed.data.reason } });
      const changed = await tx.orderItem.updateMany({ where: { id: item.id, status: { in: ["DELIVERED", "COMPLETED"] }, order: { userId: session.user.id } }, data: { status: "RETURN_REQUESTED" } });
      if (changed.count) {
        await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: session.user.id, fromStatus: item.status, toStatus: "RETURN_REQUESTED" } });
        await tx.sellerPayout.updateMany({ where: { orderItemId: item.id, status: { in: ["PENDING", "AVAILABLE", "SCHEDULED"] } }, data: { status: "BLOCKED" } });
        if (item.order.payment.status === "PAID" || item.order.payment.status === "PARTIAL_REFUND_PENDING" || item.order.payment.status === "REFUND_PENDING") await synchronizePaymentRefundStatus(tx, item.order.payment.id);
        await tx.financialAuditEvent.create({ data: { paymentId: item.order.payment.id, refundId: refund.id, orderId: item.orderId, actorUserId: session.user.id, entityType: "REFUND", entityId: refund.id, eventType: "RETURN_REQUESTED", toStatus: "REQUESTED", source: "CUSTOMER" } });
        await enqueueNotifications(tx, [{ sellerId: item.sellerId, orderId: item.orderId, type: "RETURN_REQUESTED", dedupeKey: `return-request:${refund.id}:seller`, title: "İade talebi", message: `${item.order.orderNumber} siparişindeki ${item.productName} için iade talebi oluşturuldu.` }]);
        const statuses = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } }); await tx.order.update({ where: { id: item.orderId }, data: { status: aggregateOrderStatus(statuses.map((entry) => entry.status)) } });
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
