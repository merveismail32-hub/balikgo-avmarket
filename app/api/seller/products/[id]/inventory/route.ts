import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

const productIdSchema = z.string().min(1).max(128);
const inventorySchema = z.object({
  price: z.number().finite().positive().max(9_999_999_999.99).optional(),
  stock: z.number().finite().int().min(0).max(2_147_483_647).optional(),
}).strict().refine((value) => value.price !== undefined || value.stock !== undefined);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });

  const { id } = await params;
  if (!productIdSchema.safeParse(id).success) return NextResponse.json({ error: "Geçersiz ürün kimliği." }, { status: 400 });

  const parsed = inventorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fiyat ve stok değerlerini kontrol edin." }, { status: 400 });

  const updated = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id, sellerId: seller.id }, select: { id: true } });
    if (!product) return false;
    await tx.product.update({ where: { id }, data: parsed.data });
    await tx.sellerOffer.updateMany({ where: { legacyProductId: id, sellerId: seller.id }, data: parsed.data });
    return true;
  });
  if (!updated) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });

  const product = await prisma.product.findFirst({ where: { id, sellerId: seller.id }, select: { id: true, price: true, stock: true, active: true } });
  if (!product) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  return NextResponse.json({ ...product, price: Number(product.price) });
}
