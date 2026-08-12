import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { publicProductPolicy } from "@/app/lib/product-visibility";
export const metadata: Metadata = { robots: { index: false, follow: true } };
export default async function LegacyProductPage({ searchParams }: { searchParams: Promise<{ urun?: string | string[] }> }) { const value = (await searchParams).urun; const id = typeof value === "string" ? value.slice(0, 100) : ""; if (!id) notFound(); const product = await prisma.product.findFirst({ where: { id, ...publicProductPolicy }, select: { slug: true, catalogProduct: { select: { slug: true } } } }); if (!product) notFound(); permanentRedirect(`/urun/${product.catalogProduct?.slug ?? product.slug}`); }
