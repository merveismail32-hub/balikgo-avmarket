import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingControls, Pagination } from "@/app/components/listing-controls";
import { ProductCard } from "@/app/components/product-card";
import { StorefrontFooter } from "@/app/components/storefront-footer";
import { StorefrontHeader } from "@/app/components/storefront-header";
import { listingOrder, listingWhere, PAGE_SIZE, parseListing, type ListingQuery } from "@/app/lib/listing";
import { toStoreProduct } from "@/app/lib/product-data";
import { prisma } from "@/app/lib/prisma";

async function getBrand(slug: string) {
  return prisma.brand.findFirst({ where: { slug, active: true }, select: { id: true, name: true, slug: true } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const brand = await getBrand((await params).slug);
  return brand
    ? { title: brand.name, description: `${brand.name} ürünlerini BalıkGo'da keşfedin.`, alternates: { canonical: `/marka/${brand.slug}` } }
    : { title: "Marka bulunamadı", robots: { index: false } };
}

export default async function BrandPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<ListingQuery> }) {
  const [brand, query] = await Promise.all([getBrand((await params).slug), searchParams]);
  if (!brand) notFound();
  const filters = parseListing(query);
  const where = listingWhere(filters, { brandId: brand.id });
  const [categories, rows, total] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where, include: { seller: true }, orderBy: listingOrder(filters.sort), skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.product.count({ where }),
  ]);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: base }, { "@type": "ListItem", position: 2, name: brand.name, item: `${base}/marka/${brand.slug}` }] };

  return <main className="min-h-screen bg-slate-50"><StorefrontHeader initialQuery={filters.q} /><section className="mx-auto max-w-7xl px-5 py-12"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} /><nav aria-label="İçerik yolu" className="text-sm text-slate-600"><Link href="/">Ana Sayfa</Link> / {brand.name}</nav><h1 className="mt-4 text-4xl font-black">{brand.name}</h1><p className="mt-3 text-slate-600">{brand.name} ürünlerini BalıkGo&apos;da keşfedin.</p><div className="mt-7"><ListingControls action={`/marka/${brand.slug}`} query={query} categories={categories} /></div>{rows.length > 0 ? <><p className="mt-8 text-sm text-slate-500">{total} ürün bulundu.</p><div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{rows.map((product) => <ProductCard key={product.id} product={toStoreProduct(product)} />)}</div><Pagination path={`/marka/${brand.slug}`} query={query} page={filters.page} total={total} /></> : <p className="mt-8 rounded-2xl border bg-white p-10 text-slate-500">Bu markada filtrelere uygun ürün bulunmuyor.</p>}</section><StorefrontFooter /></main>;
}
