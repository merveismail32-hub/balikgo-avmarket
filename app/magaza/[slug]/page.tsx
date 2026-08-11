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

async function getStore(slug: string) {
  return prisma.sellerProfile.findFirst({ where: { storeSlug: slug, status: "APPROVED" }, select: { id: true, storeName: true, storeSlug: true, description: true, city: true } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const store = await getStore((await params).slug);
  return store
    ? { title: store.storeName, description: store.description || `${store.storeName} mağazasının ürünlerini keşfedin.`, alternates: { canonical: `/magaza/${store.storeSlug}` } }
    : { title: "Mağaza bulunamadı", robots: { index: false } };
}

export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<ListingQuery> }) {
  const [store, query] = await Promise.all([getStore((await params).slug), searchParams]);
  if (!store) notFound();
  const filters = parseListing(query);
  const where = listingWhere(filters, { sellerId: store.id });
  const [categories, brands, rows, total] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: { active: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where, include: { seller: true }, orderBy: listingOrder(filters.sort), skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.product.count({ where }),
  ]);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: base }, { "@type": "ListItem", position: 2, name: store.storeName, item: `${base}/magaza/${store.storeSlug}` }] };

  return <main className="min-h-screen bg-slate-50 text-slate-900"><StorefrontHeader initialQuery={filters.q} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} /><section className="border-b bg-slate-950 text-white"><div className="mx-auto max-w-7xl px-5 py-12"><nav aria-label="İçerik yolu" className="text-sm text-slate-300"><Link href="/">Ana Sayfa</Link> / {store.storeName}</nav><p className="mt-5 text-sm font-bold text-sky-300">BALIKGO MAĞAZASI</p><h1 className="mt-2 text-4xl font-black">{store.storeName}</h1>{store.description && <p className="mt-4 max-w-2xl leading-7 text-slate-300">{store.description}</p>}{store.city && <p className="mt-4 text-sm font-semibold text-sky-200">{store.city}</p>}</div></section><section className="mx-auto max-w-7xl px-5 py-12"><h2 className="text-3xl font-black">Mağaza ürünleri</h2><div className="mt-7"><ListingControls action={`/magaza/${store.storeSlug}`} query={query} categories={categories} brands={brands} /></div>{rows.length > 0 ? <><p className="mt-8 text-sm text-slate-500">{total} aktif ürün</p><div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{rows.map((product) => <ProductCard key={product.id} product={toStoreProduct(product)} />)}</div><Pagination path={`/magaza/${store.storeSlug}`} query={query} page={filters.page} total={total} /></> : <p className="mt-8 rounded-2xl border bg-white p-10">Filtrelere uygun aktif ürün bulunmuyor.</p>}</section><StorefrontFooter /></main>;
}
