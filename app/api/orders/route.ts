import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { commissionFor } from "@/app/lib/commission";

const checkoutSchema = z.object({
  clientRequestId: z.string().uuid(),
  address: z.object({ recipientName: z.string().trim().min(3).max(120), phone: z.string().trim().min(8).max(30), city: z.string().trim().min(2).max(80), district: z.string().trim().min(2).max(80), address: z.string().trim().min(10).max(600), postalCode: z.string().trim().max(20).optional() }),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1).max(50),
});
const includes = { items: { include: { seller: true } } } as const;
export async function GET() {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  return NextResponse.json(await prisma.order.findMany({ where: { userId: session.user.id }, include: includes, orderBy: { createdAt: "desc" } }));
}
export async function POST(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Sipariş için giriş yapmalısınız." }, { status: 401 });
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Teslimat bilgilerini ve sepeti kontrol edin." }, { status: 400 });
  const { clientRequestId, address, items } = parsed.data;
  try {
    const duplicate = await prisma.order.findUnique({ where: { clientRequestId }, include: includes });
    if (duplicate) return NextResponse.json(duplicate);
    const order = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: items.map((item) => item.productId) }, active: true }, include: { seller: true } });
      if (products.length !== items.length) throw new Error("Sepetteki ürünlerden biri artık satışta değil.");
      const productById = new Map(products.map((product) => [product.id, product]));
      let total = 0;
      for (const item of items) {
        const product = productById.get(item.productId);
        if (!product || product.stock < item.quantity) throw new Error(`${product?.name ?? "Ürün"} için yeterli stok yok.`);
        const changed = await tx.product.updateMany({ where: { id: product.id, active: true, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
        if (!changed.count) throw new Error(`${product.name} için stok güncellendi; sepetinizi yeniden kontrol edin.`);
        total += Number(product.price) * item.quantity;
      }
      const orderNumber = `BG-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await tx.order.create({ data: { userId: session.user.id, clientRequestId, orderNumber, totalAmount: total, ...address, items: { create: items.map((item) => { const product = productById.get(item.productId)!; const money = commissionFor(product.price, item.quantity); return { productId: product.id, sellerId: product.sellerId, productName: product.name, productImageUrl: product.imageUrl, unitPrice: product.price, quantity: item.quantity, commissionRate: money.rate, commissionAmount: money.commission, sellerNetAmount: money.net, statusHistory: { create: { toStatus: "NEW" } } }; }) } }, include: includes });
      await tx.payment.create({ data: { orderId: created.id, amount: created.totalAmount, provider: "TEST_PENDING", status: "PENDING", metadata: { note: "Gerçek ödeme sağlayıcısı bağlanmadı." } } });
      for (const orderItem of created.items) {
        const grossAmount = orderItem.unitPrice.mul(orderItem.quantity);
        const payout = await tx.sellerPayout.create({ data: { sellerId: orderItem.sellerId, orderId: created.id, orderItemId: orderItem.id, grossAmount, commissionAmount: orderItem.commissionAmount ?? 0, providerFeeAmount: 0, netAmount: orderItem.sellerNetAmount ?? grossAmount.minus(orderItem.commissionAmount ?? 0), status: "PENDING" } });
        await tx.financialLedgerEntry.createMany({ data: [
          { sellerId: orderItem.sellerId, orderItemId: orderItem.id, payoutId: payout.id, type: "SALE", amount: grossAmount },
          { sellerId: orderItem.sellerId, orderItemId: orderItem.id, payoutId: payout.id, type: "COMMISSION", amount: orderItem.commissionAmount ?? 0 },
        ] });
      }
      await tx.cartItem.deleteMany({ where: { userId: session.user.id, productId: { in: items.map((item) => item.productId) } } });
      return created;
    });
    return NextResponse.json(order, { status: 201 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Sipariş oluşturulamadı.";
    const prismaError = reason as { code?: string; meta?: unknown };
    console.error("[orders] Sipariş oluşturma hatası", { message, code: prismaError.code, meta: prismaError.meta });
    const safeMessage = /stok|satışta değil/i.test(message) ? message : "Sipariş işlemi tamamlanamadı. Lütfen tekrar deneyin.";
    return NextResponse.json({ error: safeMessage }, { status: 409 });
  }
}
