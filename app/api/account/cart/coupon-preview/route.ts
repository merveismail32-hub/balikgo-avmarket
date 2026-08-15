import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { publicProductPolicy } from "@/app/lib/product-visibility";
import { evaluateCoupon } from "@/app/lib/coupon-evaluation";

const schema = z.object({ couponCode: z.string().max(50) }).strict();
export async function POST(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Geçerli bir kupon kodu girin." }, { status: 400 });
  try {
    const preview = await prisma.$transaction(async (tx) => {
      const cart = await tx.cartItem.findMany({ where: { userId: session.user.id, product: publicProductPolicy }, select: { productId: true, quantity: true, product: { select: { sellerId: true } }, sellerOffer: { select: { price: true, stock: true, active: true, sellerId: true } } } });
      if (!cart.length) throw new Error("Sepetiniz boş."); if (cart.some((line) => !line.sellerOffer?.active || line.quantity > line.sellerOffer.stock)) throw new Error("Sepetinizde stok miktarı değişen ürün var.");
      const lines = cart.map((line) => ({ productId: line.productId, quantity: line.quantity, product: { sellerId: line.sellerOffer!.sellerId, price: line.sellerOffer!.price } }));
      const subtotal = lines.reduce((sum, line) => sum.add(line.product.price.mul(line.quantity)), new Prisma.Decimal(0)); const result = await evaluateCoupon(tx, { code: parsed.data.couponCode, userId: session.user.id, lines });
      return { couponCode: result.coupon.code, subtotal: subtotal.toFixed(2), discount: result.discount.toFixed(2), total: subtotal.minus(result.discount).toFixed(2) };
    });
    return NextResponse.json(preview);
  } catch (error) { const message = error instanceof Error && /kupon|sepet|stok/i.test(error.message) ? error.message : "Kupon doğrulanamadı."; return NextResponse.json({ error: message }, { status: 409 }); }
}
