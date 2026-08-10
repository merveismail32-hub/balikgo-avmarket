import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

const productSchema = z.object({
  name: z.string().trim().min(2).max(160), category: z.string().trim().min(2).max(80), brand: z.string().trim().min(2).max(80),
  price: z.coerce.number().positive(), oldPrice: z.preprocess((value) => value === "" || value === null ? null : value, z.coerce.number().positive().nullable()), stock: z.coerce.number().int().min(0),
  description: z.string().trim().min(10).max(4000), technicalDetails: z.string().trim().max(4000).optional().default(""), shippingInfo: z.string().trim().max(500).optional().default(""),
  imageUrl: z.string().trim().min(1).max(1000), images: z.array(z.string().url()).min(1).max(8).optional(),
});
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
  const baseSlug = slugify(parsed.data.name) || "urun";
  let slug = baseSlug; let index = 2;
  while (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${baseSlug}-${index++}`;
  const images = parsed.data.images ?? [parsed.data.imageUrl];
  const product = await prisma.product.create({ data: { ...parsed.data, images, slug, sellerId: seller.id, oldPrice: parsed.data.oldPrice ?? null } });
  return NextResponse.json(product, { status: 201 });
}
