import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { duplicateSkuMessage, isDuplicateSellerSkuError, isProductSlugUniqueError } from "@/app/lib/product-sku-error";
import { normalizeSku } from "@/lib/sku";

const productSchema = z.object({
  name: z.string().trim().min(2).max(160), sku: z.string().max(80).nullable().optional(), categoryId: z.string().min(1), brandId: z.preprocess((value) => value === "" ? null : value, z.string().min(1).nullable().optional()),
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
      const product = await prisma.product.create({ data: { ...parsed.data, category: category.name, brand: brand?.name ?? "Markasız", brandId: brand?.id ?? null, sku: normalizeSku(parsed.data.sku), images, slug, sellerId: seller.id, oldPrice: parsed.data.oldPrice ?? null, moderationStatus: "PENDING" } });
      return NextResponse.json(product, { status: 201 });
    } catch (error) {
      if (isDuplicateSellerSkuError(error)) return NextResponse.json({ error: duplicateSkuMessage }, { status: 409 });
      if (!isProductSlugUniqueError(error) || attempt === 4) throw error;
    }
  }
  return NextResponse.json({ error: "Ürün adresi oluşturulamadı. Lütfen tekrar deneyin." }, { status: 409 });
}
