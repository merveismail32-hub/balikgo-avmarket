import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { duplicateSkuMessage, isDuplicateSellerSkuError } from "@/app/lib/product-sku-error";
import { normalizeSku } from "@/lib/sku";
import { setSellerAbsoluteStock, StockTruthError } from "@/app/lib/stock-truth";

const updateSchema = z.object({ stock: z.coerce.number().int().min(0).optional(), active: z.boolean().optional(), name: z.string().trim().min(2).max(160).optional(), sku: z.string().max(80).nullable().optional(), categoryId: z.string().min(1).optional(), brandId: z.preprocess((value) => value === "" ? null : value, z.string().min(1).nullable().optional()), price: z.coerce.number().positive().optional(), oldPrice: z.preprocess((value) => value === "" || value === null ? null : value, z.coerce.number().positive().nullable()).optional(), description: z.string().trim().min(10).max(4000).optional(), technicalDetails: z.string().max(4000).optional(), shippingInfo: z.string().max(500).optional(), imageUrl: z.string().min(1).max(1000).optional(), images: z.array(z.string().url()).min(1).max(8).optional() }).strict();

const guardedUpdateSchema = updateSchema.extend({ expectedInventoryVersion: z.coerce.number().int().min(0).optional() });

export async function PATCH(request: Request, { params }: RouteContext<"/api/seller/products/[id]">) {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const { id } = await params; const parsed = guardedUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz ürün bilgisi." }, { status: 400 });
  const current = await prisma.product.findFirst({ where: { id, sellerId: seller.id }, select: { name: true, categoryId: true, brandId: true, description: true, imageUrl: true, images: true, technicalDetails: true, catalogProductId: true, sellerOffer: { select: { id: true } } } });
  if (!current) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  const requestedCategoryId = parsed.data.categoryId === "__legacy__" ? undefined : parsed.data.categoryId;
  const category = requestedCategoryId ? await prisma.category.findFirst({ where: { id: requestedCategoryId, ...(requestedCategoryId === current.categoryId ? {} : { active: true }) }, select: { id: true, name: true } }) : null;
  if (requestedCategoryId && !category) return NextResponse.json({ error: "Seçilen kategori bulunamadı veya aktif değil." }, { status: 400 });
  const requestedBrandId = parsed.data.brandId === "__legacy__" ? undefined : parsed.data.brandId;
  const brand = requestedBrandId ? await prisma.brand.findFirst({ where: { id: requestedBrandId, ...(requestedBrandId === current.brandId ? {} : { active: true }) }, select: { id: true, name: true } }) : null;
  if (requestedBrandId && !brand) return NextResponse.json({ error: "Seçilen marka bulunamadı veya aktif değil." }, { status: 400 });
  const critical = (parsed.data.name !== undefined && parsed.data.name !== current.name) || (requestedCategoryId !== undefined && requestedCategoryId !== current.categoryId) || (requestedBrandId !== undefined && requestedBrandId !== current.brandId) || (parsed.data.description !== undefined && parsed.data.description !== current.description) || (parsed.data.imageUrl !== undefined && parsed.data.imageUrl !== current.imageUrl) || (parsed.data.technicalDetails !== undefined && parsed.data.technicalDetails !== current.technicalDetails) || (parsed.data.images !== undefined && JSON.stringify(parsed.data.images) !== JSON.stringify(current.images));
  if (critical && current.catalogProductId) return NextResponse.json({ error: "Ortak katalog içeriği satıcı tarafından değiştirilemez; yönetici incelemesi gerektirir." }, { status: 409 });
  const { categoryId, brandId, expectedInventoryVersion, stock: requestedStock, ...fields } = parsed.data;
  const normalizedSku = fields.sku !== undefined ? normalizeSku(fields.sku) : undefined;
  const data = { ...fields, ...(categoryId !== undefined && categoryId !== "__legacy__" && category ? { categoryId: category.id, category: category.name } : {}), ...(brandId !== undefined && brandId !== "__legacy__" ? { brandId: brand?.id ?? null, brand: brand?.name ?? "Markasız" } : {}), ...(normalizedSku !== undefined ? { sku: normalizedSku } : {}), ...(critical ? { moderationStatus: "PENDING" as const, moderationReason: null, moderatedAt: null } : {}) };
  try {
    await prisma.$transaction(async (tx) => {
      if (requestedStock !== undefined) {
        if (expectedInventoryVersion === undefined || !current.sellerOffer) throw new StockTruthError("STALE_INVENTORY_VERSION");
        await setSellerAbsoluteStock(tx, { sellerOfferId: current.sellerOffer.id, productId: id, sellerId: seller.id, expectedVersion: expectedInventoryVersion, quantity: requestedStock, idempotencyKey: `stock:v1:seller-set:${current.sellerOffer.id}:${expectedInventoryVersion}:${requestedStock}`, source: "SELLER_PRODUCT_PATCH", actorSellerId: seller.id });
      }
      await tx.product.update({ where: { id }, data });
      await tx.sellerOffer.updateMany({ where: { legacyProductId: id, sellerId: seller.id }, data: { ...(fields.price !== undefined ? { price: fields.price } : {}), ...(fields.oldPrice !== undefined ? { listPrice: fields.oldPrice } : {}), ...(fields.active !== undefined ? { active: fields.active } : {}), ...(normalizedSku !== undefined ? { sellerSku: normalizedSku } : {}) } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { if (error instanceof StockTruthError && error.code === "STALE_INVENTORY_VERSION") return NextResponse.json({ error: "Stok başka bir işlem tarafından değiştirildi; sayfayı yenileyin." }, { status: 409 }); if (isDuplicateSellerSkuError(error)) return NextResponse.json({ error: duplicateSkuMessage }, { status: 409 }); throw error; }
}

export async function DELETE(_: Request, { params }: RouteContext<"/api/seller/products/[id]">) {
  const seller = await getApprovedSeller(); if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const { id } = await params;
  const found = await prisma.product.findFirst({ where: { id, sellerId: seller.id }, select: { id: true } });
  if (!found) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  await prisma.$transaction([prisma.product.update({ where: { id }, data: { active: false } }), prisma.sellerOffer.updateMany({ where: { legacyProductId: id, sellerId: seller.id }, data: { active: false } })]);
  return NextResponse.json({ ok: true });
}
