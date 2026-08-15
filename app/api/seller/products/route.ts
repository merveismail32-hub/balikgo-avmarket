import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrGetOpenCatalogMatchReview } from "@/app/lib/catalog-match-review";
import { decideCatalogMatch, normalizeCatalogText, parseGtin } from "@/app/lib/catalog-intelligence";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { duplicateSkuMessage, isDuplicateSellerSkuError, isProductSlugUniqueError } from "@/app/lib/product-sku-error";
import { normalizeSku } from "@/lib/sku";

const productSchema = z.object({
  name: z.string().trim().min(2).max(160), sku: z.string().max(80).nullable().optional(), categoryId: z.string().min(1), brandId: z.preprocess((value) => value === "" ? null : value, z.string().min(1).nullable().optional()),
  barcode: z.preprocess((value) => value === "" ? null : value, z.string().trim().max(32).nullable().optional()), model: z.string().trim().max(160).optional(), variantKey: z.string().trim().max(191).optional(),
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
  const sellerSku = normalizeSku(parsed.data.sku);
  const gtin = parseGtin(parsed.data.barcode);
  const normalizedName = normalizeCatalogText(parsed.data.name);
  const normalizedBrand = normalizeCatalogText(brand?.name ?? "Markasız");
  const normalizedModel = normalizeCatalogText(parsed.data.model);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const [sellerSkuOffer, candidates] = await Promise.all([
        sellerSku ? prisma.sellerOffer.findUnique({ where: { sellerId_sellerSku: { sellerId: seller.id, sellerSku } }, select: { id: true, catalogProductId: true, sellerSku: true, legacyProductId: true, catalogProduct: { select: { normalizedGtin: true, barcode: true } } } }) : null,
        gtin.valid
          ? prisma.catalogProduct.findMany({ where: { normalizedGtin: gtin.normalized }, select: { id: true, normalizedGtin: true, normalizedName: true, normalizedBrand: true, normalizedModel: true } })
          : prisma.catalogProduct.findMany({ where: { normalizedName, normalizedBrand, normalizedModel }, orderBy: { id: "asc" }, take: 10, select: { id: true, normalizedGtin: true, normalizedName: true, normalizedBrand: true, normalizedModel: true } }),
      ]);
      const match = decideCatalogMatch({ gtin, sellerSku, normalizedName, normalizedBrand, normalizedModel, candidates, sellerSkuOffer });
      if (match.type === "CONFLICT" || match.type === "REVIEW_REQUIRED") {
        await createOrGetOpenCatalogMatchReview(prisma, { sellerId: seller.id, sellerOfferId: sellerSkuOffer?.id ?? null, sellerSku, proposedGtin: gtin.valid ? gtin.normalized : null, candidateIds: match.candidateIds.length ? match.candidateIds : match.catalogProductId ? [match.catalogProductId] : [], normalizedName, normalizedBrand, normalizedModel, matchStatus: match.type, reasonCode: match.reason, confidence: match.confidence });
        return NextResponse.json({ error: match.type === "CONFLICT" ? "Katalog kimliği mevcut ürün verisiyle çelişiyor; yönetici incelemesi gerekli." : "Ürün otomatik birleştirilmedi; katalog incelemesi gerekli.", reasonCode: match.reason }, { status: 409 });
      }
      if (match.type === "SELLER_SKU_MATCH" && sellerSkuOffer?.legacyProductId) {
        return NextResponse.json({ error: "Bu SKU mağazanızda zaten var; stok değişikliği için mevcut ürünü düzenleyin." }, { status: 409 });
      }
      const product = await prisma.$transaction(async (tx) => {
        const existingCatalog = match.catalogProductId ? await tx.catalogProduct.findUniqueOrThrow({ where: { id: match.catalogProductId } }) : null;
        const catalog = existingCatalog ?? await tx.catalogProduct.create({ data: { slug, name: parsed.data.name, category: category.name, brand: brand?.name ?? "Markasız", categoryId: category.id, brandId: brand?.id ?? null, model: parsed.data.model || null, barcode: parsed.data.barcode || null, normalizedGtin: gtin.valid ? gtin.normalized : null, normalizedName, normalizedBrand, normalizedModel, variantKey: parsed.data.variantKey || null, identityKey: gtin.valid ? `gtin:${gtin.normalized}` : `candidate:${crypto.randomUUID()}`, description: parsed.data.description, imageUrl: parsed.data.imageUrl, images, technicalDetails: parsed.data.technicalDetails, shippingInfo: parsed.data.shippingInfo, moderationStatus: "PENDING" } });
        const legacy = await tx.product.create({ data: { name: parsed.data.name, categoryId: category.id, category: category.name, brandId: brand?.id ?? null, brand: brand?.name ?? "Markasız", sku: sellerSku, price: parsed.data.price, oldPrice: parsed.data.oldPrice ?? null, stock: parsed.data.stock, description: parsed.data.description, technicalDetails: parsed.data.technicalDetails, shippingInfo: parsed.data.shippingInfo, imageUrl: parsed.data.imageUrl, images, slug, sellerId: seller.id, moderationStatus: "PENDING", catalogProductId: catalog.id } });
        await tx.sellerOffer.create({ data: { sellerId: seller.id, catalogProductId: catalog.id, legacyProductId: legacy.id, sellerSku, price: legacy.price, listPrice: legacy.oldPrice, stock: legacy.stock, active: legacy.active, matchStatus: match.type, matchReason: match.reason, matchConfidence: match.confidence } });
        return legacy;
      });
      return NextResponse.json(product, { status: 201 });
    } catch (error) {
      if (isDuplicateSellerSkuError(error)) return NextResponse.json({ error: duplicateSkuMessage }, { status: 409 });
      const uniqueTarget = JSON.stringify((error as { meta?: unknown }).meta ?? "");
      if ((error as { code?: string }).code === "P2002" && uniqueTarget.includes("SellerOffer_sellerId_catalogProductId_key")) return NextResponse.json({ error: "Bu katalog ürünü için mağazanızda zaten bir teklif var." }, { status: 409 });
      if ((error as { code?: string }).code === "P2002" && uniqueTarget.includes("normalizedGtin") && attempt < 4) continue;
      if (!isProductSlugUniqueError(error) || attempt === 4) throw error;
    }
  }
  return NextResponse.json({ error: "Ürün adresi oluşturulamadı. Lütfen tekrar deneyin." }, { status: 409 });
}
