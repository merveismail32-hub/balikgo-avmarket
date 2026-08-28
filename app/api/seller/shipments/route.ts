import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { createSellerShipment } from "@/app/lib/shipment-creation";

const schema = z.object({ orderId: z.string().cuid(), orderItemIds: z.array(z.string().cuid()).min(1).max(50).optional() }).strict().superRefine((value, context) => { if (value.orderItemIds && new Set(value.orderItemIds).size !== value.orderItemIds.length) context.addIssue({ code: "custom", path: ["orderItemIds"], message: "Sipariş kalemleri benzersiz olmalıdır." }); });

export async function POST(request: Request) {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sipariş." }, { status: 400 });
  try {
    const shipment = await createSellerShipment({ orderId: parsed.data.orderId, sellerId: seller.id, orderItemIds: parsed.data.orderItemIds });
    return shipment ? NextResponse.json(shipment, { status: 201 }) : NextResponse.json({ error: "Paketlenebilir sipariş kalemi bulunamadı." }, { status: 404 });
  } catch (error) { if (error instanceof Error && error.message === "PAYMENT_NOT_PAID") return NextResponse.json({ error: "Ödeme tamamlanmadan paket oluşturulamaz." }, { status: 409 }); throw error; }
}
