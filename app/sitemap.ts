import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { publicCatalogPolicy } from "@/app/lib/catalog-data";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Public catalog membership changes without a deploy; do not freeze discovery URLs at build time.
  await connection();
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const [products, categories, brands, stores] = await Promise.all([
    prisma.catalogProduct.findMany({ where: publicCatalogPolicy, select: { slug: true, updatedAt: true } }),
    prisma.category.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } }),
    prisma.brand.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } }),
    prisma.sellerProfile.findMany({ where: { status: "APPROVED" }, select: { storeSlug: true, updatedAt: true } }),
  ]);
  return [{ url: base, lastModified: new Date() }, { url: `${base}/markalar`, lastModified: new Date() }, ...products.map((x) => ({ url: `${base}/urun/${x.slug}`, lastModified: x.updatedAt })), ...categories.map((x) => ({ url: `${base}/kategori/${x.slug}`, lastModified: x.updatedAt })), ...brands.map((x) => ({ url: `${base}/marka/${x.slug}`, lastModified: x.updatedAt })), ...stores.map((x) => ({ url: `${base}/magaza/${x.storeSlug}`, lastModified: x.updatedAt }))];
}
