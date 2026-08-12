import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { ORDER_STATUS_LABELS, SELLER_CANCELLABLE_STATUSES, SHIPPING_COMPANIES } from "@/app/lib/order-status";
import type { OrderStatus } from "@prisma/client";
import { enqueueNotifications } from "@/app/lib/notifications";

const mutationSchema = z.object({
  status: z.enum(["PREPARING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "CANCELLED"]),
  shippingCompany: z.enum(SHIPPING_COMPANIES).optional(),
  trackingNumber: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._/-]+$/, "Takip numarası geçersiz karakter içeriyor.").optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "SHIPPED" && (!value.shippingCompany || !value.trackingNumber)) context.addIssue({ code: "custom", message: "Kargoya verilen sipariş için firma ve takip numarası gereklidir." });
  if (value.status !== "SHIPPED" && (value.shippingCompany || value.trackingNumber)) context.addIssue({ code: "custom", message: "Kargo bilgileri yalnızca kargoya verme işleminde gönderilebilir." });
});

const allowed: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  COMPLETED: [],
  DELIVERED: [],
  CANCELLED: [],
  RETURN_REQUESTED: ["RETURNED"],
  RETURNED: [],
};

function aggregateOrderStatus(statuses: OrderStatus[]): OrderStatus {
  const active = statuses.filter((status) => status !== "CANCELLED");
  if (!active.length) return "CANCELLED";
  if (active.every((status) => status === "DELIVERED" || status === "COMPLETED")) return "DELIVERED";
  if (active.some((status) => status === "SHIPPED" || status === "DELIVERED" || status === "COMPLETED")) return "SHIPPED";
  if (active.some((status) => status === "READY_TO_SHIP")) return "READY_TO_SHIP";
  if (active.some((status) => status === "PREPARING")) return "PREPARING";
  return "NEW";
}

export async function GET(_: Request, { params }: RouteContext<"/api/seller/orders/[id]">) {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const { id } = await params;
  const item = await prisma.orderItem.findFirst({
    where: { id, sellerId: seller.id },
    select: { id: true, orderId: true, productName: true, productSku: true, productImageUrl: true, unitPrice: true, quantity: true, status: true, shippingCompany: true, trackingNumber: true, createdAt: true, updatedAt: true, order: { select: { orderNumber: true, recipientName: true, phone: true, city: true, district: true, address: true, postalCode: true, createdAt: true } }, statusHistory: { orderBy: { createdAt: "asc" } } },
  });
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Sipariş kalemi bulunamadı." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/seller/orders/[id]">) {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz sipariş bilgisi." }, { status: 400 });

  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({ where: { id, sellerId: seller.id }, select: { orderId: true, productId: true, sellerOfferId: true, productName: true, quantity: true, status: true, order: { select: { userId: true, orderNumber: true, payment: { select: { status: true } } } } } });
      if (!item) return null;
      const target = parsed.data.status;

      if (target === item.status) {
        if (target === "SHIPPED") await tx.orderItem.updateMany({ where: { id, sellerId: seller.id, status: "SHIPPED" }, data: { shippingCompany: parsed.data.shippingCompany, trackingNumber: parsed.data.trackingNumber } });
        return { status: target, idempotent: true };
      }
      if (!allowed[item.status].includes(target)) throw new Error("INVALID_TRANSITION");
      if (target === "CANCELLED" && !SELLER_CANCELLABLE_STATUSES.includes(item.status)) throw new Error("INVALID_TRANSITION");

      const changed = await tx.orderItem.updateMany({
        where: { id, sellerId: seller.id, status: item.status },
        data: { status: target, ...(target === "SHIPPED" ? { shippingCompany: parsed.data.shippingCompany, trackingNumber: parsed.data.trackingNumber } : {}) },
      });
      if (!changed.count) {
        const latest = await tx.orderItem.findFirst({ where: { id, sellerId: seller.id }, select: { status: true } });
        if (latest?.status === target) return { status: target, idempotent: true };
        throw new Error("CONCURRENT_CHANGE");
      }

      await tx.orderStatusHistory.create({ data: { orderItemId: id, changedByUserId: seller.userId, fromStatus: item.status, toStatus: target } });
      await enqueueNotifications(tx, [{ userId: item.order.userId, orderId: item.orderId, type: `ORDER_${target}`, dedupeKey: `order-status:${id}:${target}:customer`, title: "Sipariş durumu güncellendi", message: `${item.order.orderNumber} siparişindeki ${item.productName} ürünü için yeni durum: ${ORDER_STATUS_LABELS[target]}.` }]);
      if (target === "CANCELLED") {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        if (item.sellerOfferId) await tx.sellerOffer.update({ where: { id: item.sellerOfferId }, data: { stock: { increment: item.quantity } } });
        await tx.sellerPayout.updateMany({ where: { orderItemId: id, status: { in: ["PENDING", "BLOCKED", "AVAILABLE", "SCHEDULED"] } }, data: { status: "CANCELLED" } });
      }
      if (target === "DELIVERED" && item.order.payment?.status === "PAID") await tx.sellerPayout.updateMany({ where: { orderItemId: id, status: "PENDING" }, data: { status: "AVAILABLE", availableAt: new Date() } });

      const orderItems = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } });
      await tx.order.update({ where: { id: item.orderId }, data: { status: aggregateOrderStatus(orderItems.map((orderItem) => orderItem.status)) } });
      return { status: target, idempotent: false };
    });

    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "Sipariş kalemi bulunamadı." }, { status: 404 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "";
    if (message === "INVALID_TRANSITION" || message === "CONCURRENT_CHANGE") return NextResponse.json({ error: "Sipariş durumu bu işlem için uygun değil." }, { status: 409 });
    console.error("[seller-orders] Sipariş güncellenemedi", { orderItemId: id, sellerId: seller.id, code: (reason as { code?: string }).code });
    return NextResponse.json({ error: "Sipariş güncellenemedi. Lütfen tekrar deneyin." }, { status: 500 });
  }
}
