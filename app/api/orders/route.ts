import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { commissionFor, commissionRateForSeller } from "@/app/lib/commission";
import { enqueueNotifications } from "@/app/lib/notifications";
import { publicProductPolicy } from "@/app/lib/product-visibility";
import { normalizeCouponCode } from "@/app/lib/coupon";
import { evaluateCoupon } from "@/app/lib/coupon-evaluation";
import { customerOrderSelect } from "@/app/lib/customer-order-select";
import { ensureCatalogForProduct } from "@/app/lib/catalog-sync";
import { revalidateOffer } from "@/app/lib/buybox";
import { decrementForCheckout, StockTruthError } from "@/app/lib/stock-truth";

const checkoutSchema = z.object({
  clientRequestId: z.string().uuid(),
  address: z.object({ recipientName: z.string().trim().min(3).max(120), phone: z.string().trim().min(8).max(30), city: z.string().trim().min(2).max(80), district: z.string().trim().min(2).max(80), address: z.string().trim().min(10).max(600), postalCode: z.string().trim().max(20).optional() }),
  items: z.array(z.object({ productId: z.string().min(1), catalogProductId: z.string().min(1).optional(), sellerOfferId: z.string().min(1).optional(), quantity: z.number().int().min(1).max(99) }).strict()).min(1).max(50),
  couponCode: z.string().max(50).optional(),
}).strict().superRefine((value, context) => {
  const productIds = value.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) context.addIssue({ code: "custom", path: ["items"], message: "Aynı ürün sepette birden fazla satırda gönderilemez." });
});
const internalIncludes = { items: { include: { seller: { select: { id: true, storeName: true, storeSlug: true } } } } } as const;
export async function GET() {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  return NextResponse.json(await prisma.order.findMany({ where: { userId: session.user.id }, select: customerOrderSelect, orderBy: { createdAt: "desc" } }));
}
export async function POST(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Sipariş için giriş yapmalısınız." }, { status: 401 });
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Teslimat bilgilerini ve sepeti kontrol edin." }, { status: 400 });
  const { clientRequestId, address, items } = parsed.data; const requestedCouponCode=normalizeCouponCode(parsed.data.couponCode);
  try {
    const duplicate = await prisma.order.findUnique({ where: { clientRequestId }, select: { id: true, orderNumber: true } });
    if (duplicate) return NextResponse.json(duplicate);
    const order = await prisma.$transaction(async (tx) => {
      const reservationExpiresAt = new Date(Date.now() + 15 * 60_000);
      for (const item of items) await ensureCatalogForProduct(tx, item.productId);
      const products = await tx.product.findMany({ where: { id: { in: items.map((item) => item.productId) }, ...publicProductPolicy }, include: { seller: true, sellerOffer: { include: { seller: true, catalogProduct: true } } } });
      if (products.length !== items.length) throw new Error("Sepetteki ürünlerden biri artık satışta değil.");
      if (products.some((product) => !product.sellerOffer || !product.catalogProductId || !product.sellerOffer.active)) throw new Error("Sepetteki satıcı teklifi artık satışta değil.");
      const productById = new Map(products.map((product) => [product.id, product]));
      let total = new Prisma.Decimal(0);
      for (const item of items) {
        const product = productById.get(item.productId);
        if (!product?.sellerOffer || !product.catalogProductId) throw new Error("Sepetteki satıcı teklifi artık satışta değil.");
        if ((item.sellerOfferId && item.sellerOfferId !== product.sellerOffer.id) || (item.catalogProductId && item.catalogProductId !== product.catalogProductId) || product.sellerOffer.catalogProductId !== product.catalogProductId || product.sellerOffer.sellerId !== product.sellerId) throw new Error("Sepetteki ürün ile satıcı teklifi eşleşmiyor.");
        const validation = revalidateOffer(product.sellerOffer.catalogProduct, { ...product.sellerOffer, price: Number(product.sellerOffer.price), sellerStatus: product.sellerOffer.seller.status }, item.quantity);
        if (!validation.eligible) throw new Error(`${product.name} için seçili satıcı teklifi artık uygun değil.`);
        try { await decrementForCheckout(tx, { sellerOfferId: product.sellerOffer.id, productId: product.id, sellerId: product.sellerId, quantity: item.quantity, idempotencyKey: `stock:v1:checkout:${clientRequestId}:${product.sellerOffer.id}`, source: "CHECKOUT", actorSellerId: product.sellerId }); }
        catch (error) { if (error instanceof StockTruthError && error.code === "INSUFFICIENT_STOCK") throw new Error(`${product.name} için stok güncellendi; sepetinizi yeniden kontrol edin.`); throw error; }
        total = total.add(product.sellerOffer.price.mul(item.quantity)).toDecimalPlaces(2);
      }
      const subtotal=total;let coupon=null;let discount=new Prisma.Decimal(0);let discounts=new Map<string,Prisma.Decimal>();
      if(requestedCouponCode){const evaluated=await evaluateCoupon(tx,{code:requestedCouponCode,userId:session.user.id,lines:items.map((item)=>{const product=productById.get(item.productId)!;return{productId:item.productId,quantity:item.quantity,product:{sellerId:product.sellerOffer!.sellerId,price:product.sellerOffer!.price}}})});coupon=evaluated.coupon;discount=evaluated.discount;discounts=evaluated.discounts;total=subtotal.minus(discount);}
      const orderNumber = `BG-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await tx.order.create({ data: { userId: session.user.id, clientRequestId, orderNumber, subtotalAmount:subtotal,discountAmount:discount,couponId:coupon?.id,couponCode:coupon?.code,totalAmount: total, ...address, items: { create: items.map((item) => { const product = productById.get(item.productId)!;const offer=product.sellerOffer!;const itemDiscount=discounts.get(product.id)??new Prisma.Decimal(0); const money = commissionFor(offer.price.mul(item.quantity).minus(itemDiscount),1, commissionRateForSeller(product.sellerId)); return { productId: product.id, catalogProductId: product.catalogProductId, sellerOfferId: offer.id, sellerId: product.sellerId, productName: product.name, productSku: offer.sellerSku, productImageUrl: product.imageUrl, unitPrice: offer.price, quantity: item.quantity,discountAmount:itemDiscount, commissionRate: money.rate, commissionAmount: money.commission, sellerNetAmount: money.net, stockReservationState: "RESERVED", statusHistory: { create: { toStatus: "NEW" } } }; }) } }, include: internalIncludes });
      if(coupon){const claimed=await tx.coupon.updateMany({where:{id:coupon.id,active:true,usageCount:coupon.usageCount},data:{usageCount:{increment:1}}});if(!claimed.count)throw new Error("Kupon kullanım limiti eşzamanlı olarak doldu.");await tx.couponRedemption.create({data:{couponId:coupon.id,userId:session.user.id,orderId:created.id,discountAmount:discount}});}
      await tx.payment.create({ data: { orderId: created.id, amount: created.totalAmount, provider: "TEST_PENDING", idempotencyKey: `order:${clientRequestId}:payment`, status: "PENDING", reservationExpiresAt, metadata: { note: "Gerçek ödeme sağlayıcısı bağlanmadı." } } });
      for (const orderItem of created.items) {
        const grossAmount = orderItem.unitPrice.mul(orderItem.quantity).minus(orderItem.discountAmount);
        const payout = await tx.sellerPayout.create({ data: { sellerId: orderItem.sellerId, orderId: created.id, orderItemId: orderItem.id, grossAmount, commissionAmount: orderItem.commissionAmount ?? 0, providerFeeAmount: 0, netAmount: orderItem.sellerNetAmount ?? grossAmount.minus(orderItem.commissionAmount ?? 0), status: "PENDING" } });
        await tx.financialLedgerEntry.createMany({ data: [
          { sellerId: orderItem.sellerId, orderItemId: orderItem.id, payoutId: payout.id, type: "SALE", amount: grossAmount },
          { sellerId: orderItem.sellerId, orderItemId: orderItem.id, payoutId: payout.id, type: "COMMISSION", amount: orderItem.commissionAmount ?? 0 },
        ] });
      }
      await tx.cartItem.deleteMany({ where: { userId: session.user.id, productId: { in: items.map((item) => item.productId) } } });
      await enqueueNotifications(tx, [{ userId: session.user.id, orderId: created.id, type: "ORDER_CREATED", dedupeKey: `order-created:${created.id}:customer`, title: "Siparişiniz alındı", message: `${created.orderNumber} numaralı siparişiniz oluşturuldu. Ödeme henüz bekliyor.` }]);
      return { id: created.id, orderNumber: created.orderNumber };
    });
    return NextResponse.json(order, { status: 201 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Sipariş oluşturulamadı.";
    const prismaError = reason as { code?: string; meta?: unknown };
    console.error("[orders] Sipariş oluşturma hatası", { message, code: prismaError.code, meta: prismaError.meta });
    const safeMessage = /stok|satışta değil|kupon|sepet tutarı/i.test(message) ? message : "Sipariş işlemi tamamlanamadı. Lütfen tekrar deneyin.";
    return NextResponse.json({ error: safeMessage }, { status: 409 });
  }
}
