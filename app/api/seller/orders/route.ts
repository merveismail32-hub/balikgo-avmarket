import { NextResponse } from "next/server";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  return NextResponse.json(await prisma.orderItem.findMany({
    where: { sellerId: seller.id },
    select: { id: true, orderId: true, productName: true, productSku: true, productImageUrl: true, unitPrice: true, quantity: true, status: true, shippingCompany: true, trackingNumber: true, createdAt: true, order: { select: { orderNumber: true, recipientName: true, phone: true, city: true, district: true, address: true, postalCode: true, createdAt: true } } },
    orderBy: { createdAt: "desc" },
  }));
}
