import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { enqueueNotifications } from "@/app/lib/notifications";
import { synchronizePaymentRefundStatus } from "@/app/lib/order-orchestrator";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz iade kararı." }, { status: 400 });
  const { id } = await params; const target = parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  try {
    const result = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id }, select: { id: true, status: true, orderId: true, orderItemId: true, paymentId: true, requestedByUserId: true, sellerId: true, payment: { select: { status: true } }, order: { select: { orderNumber: true } } } });
      if (!refund) return null;
      if (refund.status === target) return { status: target, idempotent: true };
      if (refund.status !== "REQUESTED") throw new Error("INVALID_STATE");
      const changed = await tx.refund.updateMany({ where: { id, status: "REQUESTED" }, data: { status: target } });
      if (!changed.count) throw new Error("CONCURRENT_CHANGE");
      if (target === "REJECTED") {
        const restored = await tx.orderItem.updateMany({ where: { id: refund.orderItemId, status: "RETURN_REQUESTED" }, data: { status: "DELIVERED" } });
        if (restored.count) await tx.orderStatusHistory.create({ data: { orderItemId: refund.orderItemId, changedByUserId: session.user.id, fromStatus: "RETURN_REQUESTED", toStatus: "DELIVERED" } });
        await tx.sellerPayout.updateMany({ where: { orderItemId: refund.orderItemId, status: "BLOCKED" }, data: refund.payment.status === "PAID" ? { status: "AVAILABLE", availableAt: new Date() } : { status: "PENDING", availableAt: null } });
        const statuses = await tx.orderItem.findMany({ where: { orderId: refund.orderId }, select: { status: true } });
        if (statuses.every((entry) => entry.status === "DELIVERED" || entry.status === "COMPLETED")) await tx.order.update({ where: { id: refund.orderId }, data: { status: "DELIVERED" } });
      }
      await synchronizePaymentRefundStatus(tx, refund.paymentId);
      await tx.financialAuditEvent.create({ data: { paymentId: refund.paymentId, refundId: refund.id, orderId: refund.orderId, actorUserId: session.user.id, entityType: "REFUND", entityId: refund.id, eventType: `REFUND_${target}`, fromStatus: refund.status, toStatus: target, source: "ADMIN" } });
      await enqueueNotifications(tx, [{ userId: refund.requestedByUserId ?? undefined, orderId: refund.orderId, type: `REFUND_${target}`, dedupeKey: `refund:${refund.id}:${target}:customer`, title: target === "APPROVED" ? "İade talebi onaylandı" : "İade talebi sonuçlandı", message: `${refund.order.orderNumber} numaralı siparişinizin iade talebi ${target === "APPROVED" ? "onaylandı; finansal iade henüz tamamlanmadı" : "reddedildi"}.` }, { sellerId: refund.sellerId, orderId: refund.orderId, type: `REFUND_${target}`, dedupeKey: `refund:${refund.id}:${target}:seller`, title: "İade talebi güncellendi", message: `${refund.order.orderNumber} siparişindeki iade talebi güncellendi.` }]);
      return { status: target, idempotent: false };
    });
    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "İade kaydı bulunamadı." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INVALID_STATE" || message === "CONCURRENT_CHANGE") return NextResponse.json({ error: "İade talebi mevcut durumunda bu işlem için uygun değil." }, { status: 409 });
    console.error("[admin-refund] failed", { refundId: id, code: (error as { code?: string }).code });
    return NextResponse.json({ error: "İade talebi güncellenemedi." }, { status: 500 });
  }
}
