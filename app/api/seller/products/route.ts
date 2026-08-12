import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { duplicateSkuMessage, isDuplicateSellerSkuError, isProductSlugUniqueError } from "@/app/lib/product-sku-error";
import { normalizeSku } from "@/lib/sku";

const productSchema = z.object({
  name: z.string().trim().min(2).max(160), sku: z.string().max(80).nullable().optional(), categoryId: z.string().min(1), brandId: z.preprocess((value) => value === "" ? null : value, z.string().min(1).nullable().optional()),
  barcode: z.preprocess((value) => value === "" ? null : value, z.string().trim().regex(/^\d{8,14}$/).nullable().optional()), model: z.string().trim().max(160).optional(), variantKey: z.string().trim().max(191).optional(),
  price: z.coerce.number().positive(), oldPrice: z.preprocess((value) => value === "" || value === null ? null : value, z.coerce.number().positive().nullable()), stock: z.coerce.number().int().min(0),
  description: z.string().trim().min(10).max(4000), technicalDetails: z.string().trim().max(4000).optional().default(""), shippingInfo: z.string().trim().max(500).optional().default(""),
  imageUrl: z.string().trim().min(1).max(1000), images: z.array(z.string().url()).min(1).max(8).optional(),
}).strict();
function slugify(value: string) { return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
export async function GET() {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  return NextResponse.json(await prisma.product.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" } }));
}
export async function POST(request: Request) {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = productSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Lütfen zorunlu ürün alanlarını doğru doldurun." }, { status: 400 });
  const [category, brand] = await Promise.all([
    prisma.category.findFirst({ where: { id: parsed.data.categoryId, active: true }, select: { id: true, name: true } }),
    parsed.data.brandId ? prisma.brand.findFirst({ where: { id: parsed.data.brandId, active: true }, select: { id: true, name: true } }) : null,
  ]);
  if (!category || (parsed.data.brandId && !brand)) return NextResponse.json({ error: "Seçilen kategori veya marka kullanılamıyor." }, { status: 400 });
  const baseSlug = slugify(parsed.data.name) || "urun";
  const images = parsed.data.images ?? [parsed.data.imageUrl];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const product = await prisma.$transaction(async (tx) => {
        const barcode = parsed.data.barcode?.replace(/\D/g, "") || null;
        const existingCatalog = barcode ? await tx.catalogProduct.findUnique({ where: { barcode } }) : null;
        const catalog = existingCatalog ?? await tx.catalogProduct.create({ data: { slug, name: parsed.data.name, category: category.name, brand: brand?.name ?? "Markasız", categoryId: category.id, brandId: brand?.id ?? null, model: parsed.data.model || null, barcode, variantKey: parsed.data.variantKey || null, identityKey: barcode ? `barcode:${barcode}` : `candidate:${crypto.randomUUID()}`, description: parsed.data.description, imageUrl: parsed.data.imageUrl, images, technicalDetails: parsed.data.technicalDetails, shippingInfo: parsed.data.shippingInfo, moderationStatus: "PENDING" } });
        const legacy = await tx.product.create({ data: { name: parsed.data.name, categoryId: category.id, category: category.name, brandId: brand?.id ?? null, brand: brand?.name ?? "Markasız", sku: normalizeSku(parsed.data.sku), price: parsed.data.price, oldPrice: parsed.data.oldPrice ?? null, stock: parsed.data.stock, description: parsed.data.description, technicalDetails: parsed.data.technicalDetails, shippingInfo: parsed.data.shippingInfo, imageUrl: parsed.data.imageUrl, images, slug, sellerId: seller.id, moderationStatus: "PENDING", catalogProductId: catalog.id } });
        await tx.sellerOffer.create({ data: { sellerId: seller.id, catalogProductId: catalog.id, legacyProductId: legacy.id, sellerSku: legacy.sku, price: legacy.price, listPrice: legacy.oldPrice, stock: legacy.stock, active: legacy.active } });
        return legacy;
      });
      return NextResponse.json(product, { status: 201 });
    } catch (error) {
      if (isDuplicateSellerSkuError(error)) return NextResponse.json({ error: duplicateSkuMessage }, { status: 409 });
      if ((error as { code?: string }).code === "P2002" && JSON.stringify((error as { meta?: unknown }).meta ?? "").includes("SellerOffer_sellerId_catalogProductId_key")) return NextResponse.json({ error: "Bu katalog ürünü için mağazanızda zaten bir teklif var." }, { status: 409 });
      if (!isProductSlugUniqueError(error) || attempt === 4) throw error;
    }
  }
  return NextResponse.json({ error: "Ürün adresi oluşturulamadı. Lütfen tekrar deneyin." }, { status: 409 });
}
