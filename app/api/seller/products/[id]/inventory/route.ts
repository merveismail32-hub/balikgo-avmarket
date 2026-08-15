import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { setSellerAbsoluteStock, StockTruthError } from "@/app/lib/stock-truth";

const productIdSchema = z.string().min(1).max(128);
const inventorySchema = z.object({
  price: z.number().finite().positive().max(9_999_999_999.99).optional(),
  stock: z.number().finite().int().min(0).max(2_147_483_647).optional(),
  expectedInventoryVersion: z.number().int().min(0).optional(),
}).strict().refine((value) => value.price !== undefined || value.stock !== undefined);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });

  const { id } = await params;
  if (!productIdSchema.safeParse(id).success) return NextResponse.json({ error: "Geçersiz ürün kimliği." }, { status: 400 });

  const parsed = inventorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fiyat ve stok değerlerini kontrol edin." }, { status: 400 });

  try {
  const updated = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id, sellerId: seller.id }, select: { id: true, sellerOffer: { select: { id: true } } } });
    if (!product) return false;
    if (parsed.data.stock !== undefined) {
      if (parsed.data.expectedInventoryVersion === undefined || !product.sellerOffer) throw new StockTruthError("STALE_INVENTORY_VERSION");
      await setSellerAbsoluteStock(tx, { sellerOfferId: product.sellerOffer.id, productId: id, sellerId: seller.id, expectedVersion: parsed.data.expectedInventoryVersion, quantity: parsed.data.stock, idempotencyKey: `stock:v1:seller-set:${product.sellerOffer.id}:${parsed.data.expectedInventoryVersion}:${parsed.data.stock}`, source: "SELLER_INVENTORY", actorSellerId: seller.id });
    }
    if (parsed.data.price !== undefined) await tx.product.update({ where: { id }, data: { price: parsed.data.price } });
    if (parsed.data.price !== undefined) await tx.sellerOffer.updateMany({ where: { legacyProductId: id, sellerId: seller.id }, data: { price: parsed.data.price } });
    return true;
  });
  if (!updated) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });

  const product = await prisma.product.findFirst({ where: { id, sellerId: seller.id }, select: { id: true, price: true, active: true, sellerOffer: { select: { stock: true, inventoryVersion: true } } } });
  if (!product) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  return NextResponse.json({ ...product, stock: product.sellerOffer?.stock ?? 0, inventoryVersion: product.sellerOffer?.inventoryVersion, sellerOffer: undefined, price: Number(product.price) });
  } catch (error) { if (error instanceof StockTruthError && error.code === "STALE_INVENTORY_VERSION") return NextResponse.json({ error: "Stok başka bir işlem tarafından değiştirildi; sayfayı yenileyin." }, { status: 409 }); throw error; }
}
