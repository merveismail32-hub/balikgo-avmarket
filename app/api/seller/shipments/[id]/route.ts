import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { CARRIERS } from "@/app/lib/shipping";
import { transitionSellerShipment } from "@/app/lib/shipment-orchestrator";

const schema = z.object({ status: z.enum(["PREPARING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "CANCELLED"]), carrierCode: z.enum(CARRIERS.map((carrier) => carrier.code) as [string, ...string[]]).optional(), trackingNumber: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._/-]+$/).optional() }).strict().superRefine((value, context) => {
  if (value.status === "SHIPPED" && (!value.carrierCode || !value.trackingNumber)) context.addIssue({ code: "custom", message: "Kargo firması ve geçerli takip numarası gereklidir." });
  if (value.status !== "SHIPPED" && (value.carrierCode || value.trackingNumber)) context.addIssue({ code: "custom", message: "Kargo bilgileri yalnızca kargoya verme aşamasında gönderilebilir." });
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const seller = await getSellerForFulfillment(); if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz gönderi bilgisi." }, { status: 400 });
  const { id } = await params;
  try {
    const result = await transitionSellerShipment({
      shipmentId: id, sellerId: seller.id, sellerUserId: seller.userId, status: parsed.data.status,
      carrierCode: parsed.data.carrierCode, trackingNumber: parsed.data.trackingNumber,
    });
    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "Paket bulunamadı." }, { status: 404 });
  } catch (error) { const message = error instanceof Error ? error.message : ""; if (["INVALID_TRANSITION", "CONCURRENT_CHANGE"].includes(message)) return NextResponse.json({ error: "Paket durumu bu işlem için uygun değil." }, { status: 409 }); console.error("[seller-shipment] update failed", { shipmentId: id, sellerId: seller.id, code: (error as { code?: string }).code }); return NextResponse.json({ error: "Paket güncellenemedi." }, { status: 500 }); }
}
