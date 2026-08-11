import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerForFulfillment } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

const querySchema = z.object({ after: z.string().datetime({ offset: true }).optional() }).strict();

export async function GET(request: Request) {
  const seller = await getSellerForFulfillment();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ after: url.searchParams.get("after") || undefined });
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz zaman bilgisi." }, { status: 400 });

  const cursor = new Date().toISOString();
  const orders = await prisma.order.findMany({
    where: {
      items: { some: { sellerId: seller.id } },
      ...(parsed.data.after ? { createdAt: { gt: new Date(parsed.data.after) } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, orderNumber: true, createdAt: true },
  });

  return NextResponse.json({
    orders: orders.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() })),
    serverTime: cursor,
  });
}
