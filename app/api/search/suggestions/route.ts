import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { publicCatalogPolicy } from "@/app/lib/catalog-data";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return NextResponse.json([]);
  const [products, categories, brands] = await Promise.all([
    prisma.catalogProduct.findMany({ where: { ...publicCatalogPolicy, OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }] }, select: { name: true, slug: true }, take: 5 }),
    prisma.category.findMany({ where: { active: true, name: { contains: q, mode: "insensitive" } }, select: { name: true, slug: true }, take: 2 }),
    prisma.brand.findMany({ where: { active: true, name: { contains: q, mode: "insensitive" } }, select: { name: true, slug: true }, take: 2 }),
  ]);
  return NextResponse.json([...products.map((x) => ({ type: "product", label: x.name, href: `/urun/${x.slug}` })), ...categories.map((x) => ({ type: "category", label: x.name, href: `/kategori/${x.slug}` })), ...brands.map((x) => ({ type: "brand", label: x.name, href: `/marka/${x.slug}` }))]);
}
