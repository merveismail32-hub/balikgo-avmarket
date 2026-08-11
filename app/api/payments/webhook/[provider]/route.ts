import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { enqueueNotifications } from "@/app/lib/notifications";
import { paymentAdapterFor } from "@/app/lib/payments";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toUpperCase();
  const adapter = paymentAdapterFor(provider);
  if (!adapter) return NextResponse.json({ error: "Ödeme sağlayıcısı desteklenmiyor." }, { status: 404 });
  const rawBody = await request.text();
  try {
    const event = await adapter.verifyAndParseWebhook(request, rawBody);
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentEvent.findUnique({ where: { provider_providerEventId: { provider, providerEventId: event.eventId } }, select: { id: true } });
      if (duplicate) return { duplicate: true };
      const payment = await tx.payment.findUnique({ where: { id: event.paymentId }, select: { id: true, orderId: true, amount: true, currency: true, status: true, provider: true, providerPaymentId: true, order: { select: { userId: true, orderNumber: true, items: { select: { sellerId: true } } } } } });
      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      if (!payment.amount.equals(new Prisma.Decimal(event.amount)) || payment.currency !== event.currency) throw new Error("AMOUNT_MISMATCH");
      if (payment.provider !== provider && !(provider === "TEST" && payment.provider === "TEST_PENDING")) throw new Error("PAYMENT_MISMATCH");
      if (payment.providerPaymentId && event.providerPaymentId && payment.providerPaymentId !== event.providerPaymentId) throw new Error("PAYMENT_MISMATCH");
      await tx.paymentEvent.create({ data: { paymentId: payment.id, provider, providerEventId: event.eventId, eventType: event.eventType, payloadHash: createHash("sha256").update(rawBody).digest("hex") } });
      const target = event.eventType === "PAYMENT_PAID" ? "PAID" : "FAILED";
      const changed = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "AUTHORIZED"] } }, data: { status: target, providerPaymentId: event.providerPaymentId, ...(target === "PAID" ? { paidAt: new Date() } : { failedAt: new Date() }) } });
      await tx.financialAuditEvent.create({ data: { paymentId: payment.id, orderId: payment.orderId, entityType: "PAYMENT", entityId: payment.id, eventType: event.eventType, fromStatus: payment.status, toStatus: changed.count ? target : payment.status, source: `WEBHOOK_${provider}`, externalEventId: event.eventId } });
      if (changed.count && target === "PAID") {
        await tx.sellerPayout.updateMany({ where: { orderId: payment.orderId, status: "PENDING", orderItem: { status: { in: ["DELIVERED", "COMPLETED"] } } }, data: { status: "AVAILABLE", availableAt: new Date() } });
        const sellerIds = [...new Set(payment.order.items.map((item) => item.sellerId))];
        await enqueueNotifications(tx, [{ userId: payment.order.userId, orderId: payment.orderId, type: "PAYMENT_PAID", dedupeKey: `payment-paid:${payment.id}:customer`, title: "Ödemeniz alındı", message: `${payment.order.orderNumber} numaralı siparişinizin ödemesi doğrulandı.` }, ...sellerIds.map((sellerId) => ({ sellerId, orderId: payment.orderId, type: "SELLER_NEW_ORDER", dedupeKey: `payment-paid:${payment.id}:seller:${sellerId}`, title: "Yeni sipariş", message: `${payment.order.orderNumber} numaralı siparişte mağazanıza ait ürünler bulunuyor.` }))]);
      }
      return { duplicate: false };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && JSON.stringify(error.meta ?? "").includes("providerEventId")) return NextResponse.json({ ok: true, duplicate: true });
    if (["TEST_PROVIDER_DISABLED", "WEBHOOK_SECRET_MISSING", "INVALID_SIGNATURE", "STALE_WEBHOOK"].includes(code)) return NextResponse.json({ error: "Webhook doğrulanamadı." }, { status: 401 });
    if (code === "PAYMENT_NOT_FOUND") return NextResponse.json({ error: "Ödeme kaydı bulunamadı." }, { status: 404 });
    if (code === "AMOUNT_MISMATCH" || code === "PAYMENT_MISMATCH") return NextResponse.json({ error: "Ödeme bilgileri beklenen siparişle eşleşmiyor." }, { status: 409 });
    console.error("[payment-webhook] processing failed", { provider, code: (error as { code?: string }).code });
    return NextResponse.json({ error: "Ödeme doğrulanamadı." }, { status: 500 });
  }
}
