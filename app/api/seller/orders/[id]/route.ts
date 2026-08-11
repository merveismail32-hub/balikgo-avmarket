import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import type { OrderStatus } from "@prisma/client";

const schema = z.object({
  status: z.enum(["PREPARING", "READY_TO_SHIP", "SHIPPED", "DELIVERED"]),
  shippingCompany: z.string().trim().max(120).nullish().transform((value) => value ?? undefined),
  trackingNumber: z.string().trim().max(120).nullish().transform((value) => value ?? undefined),
}).superRefine((value, context) => {
  if (value.status === "SHIPPED" && (!value.shippingCompany || !value.trackingNumber)) {
    context.addIssue({ code: "custom", message: "Kargoya verilen sipariş için firma ve takip numarası gereklidir." });
  }
});

function aggregateOrderStatus(statuses: OrderStatus[]): OrderStatus {
  const active = statuses.filter((status) => status !== "CANCELLED");
  if (!active.length) return "CANCELLED";
  if (active.every((status) => status === "DELIVERED" || status === "COMPLETED")) return "DELIVERED";
  if (active.some((status) => status === "SHIPPED" || status === "DELIVERED" || status === "COMPLETED")) return "SHIPPED";
  if (active.some((status) => status === "READY_TO_SHIP")) return "READY_TO_SHIP";
  if (active.some((status) => status === "PREPARING")) return "PREPARING";
  return "NEW";
}
export async function GET(_: Request, { params }: RouteContext<"/api/seller/orders/[id]">) { const seller = await getApprovedSeller(); if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 }); const { id } = await params; const item = await prisma.orderItem.findFirst({ where: { id, sellerId: seller.id }, include: { order: { include: { user: { select: { name: true, surname: true } } } } } }); return item ? NextResponse.json(item) : NextResponse.json({ error: "Sipariş kalemi bulunamadı." }, { status: 404 }); }
export async function PATCH(request: Request, { params }: RouteContext<"/api/seller/orders/[id]">) {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz sipariş bilgisi." }, { status: 400 });

  const { id } = await params;
  try {
    const changed = await prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({ where: { id, sellerId: seller.id }, select: { orderId: true, status: true } });
      if (!item) return false;
      const allowed: Record<string, string[]> = { NEW: ["PREPARING"], PREPARING: ["READY_TO_SHIP"], READY_TO_SHIP: ["SHIPPED"], SHIPPED: ["DELIVERED"], COMPLETED: [], DELIVERED: [], CANCELLED: [], RETURN_REQUESTED: ["RETURNED"], RETURNED: [] };
      console.info("[seller-orders] status update", { orderItemId: id, sellerId: seller.id, currentStatus: item.status, targetStatus: parsed.data.status, shippingCompany: parsed.data.shippingCompany ?? null, hasTrackingNumber: Boolean(parsed.data.trackingNumber?.trim()) });
      if (parsed.data.status !== item.status && !allowed[item.status].includes(parsed.data.status)) throw new Error("Geçersiz sipariş durum geçişi.");

      await tx.orderItem.update({ where: { id }, data: parsed.data });
      if (parsed.data.status !== item.status) await tx.orderStatusHistory.create({ data: { orderItemId: id, fromStatus: item.status, toStatus: parsed.data.status } });
      if (parsed.data.status === "DELIVERED") await tx.sellerPayout.updateMany({ where: { orderItemId: id, status: "PENDING" }, data: { status: "AVAILABLE", availableAt: new Date() } });
      const items = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } });
      await tx.order.update({
        where: { id: item.orderId },
        data: { status: aggregateOrderStatus(items.map((orderItem) => orderItem.status)) },
      });
      return true;
    });

    return changed
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Sipariş kalemi bulunamadı." }, { status: 404 });
  } catch (reason) {
    const error = reason as { code?: string; meta?: unknown };
    const message = reason instanceof Error ? reason.message : "Bilinmeyen hata";
    console.error("[seller-orders] Kargo bilgisi güncelleme hatası", { orderItemId: id, sellerId: seller.id, targetStatus: parsed.data.status, shippingCompany: parsed.data.shippingCompany ?? null, hasTrackingNumber: Boolean(parsed.data.trackingNumber?.trim()), message, code: error.code, meta: error.meta });
    if (message === "Geçersiz sipariş durum geçişi.") return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: "Kargo bilgileri kaydedilemedi. Lütfen tekrar deneyin." }, { status: 500 });
  }
}
