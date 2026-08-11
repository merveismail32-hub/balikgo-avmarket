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

async function getCategory(slug: string) {
  return prisma.category.findFirst({ where: { slug, active: true }, select: { id: true, name: true, slug: true, parent: { select: { name: true, slug: true } }, children: { where: { active: true }, select: { id: true, name: true, slug: true }, orderBy: { sortOrder: "asc" } } } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const category = await getCategory((await params).slug);
  return category
    ? { title: category.name, description: `${category.name} ürünlerini BalıkGo'da keşfedin.`, alternates: { canonical: `/kategori/${category.slug}` } }
    : { title: "Kategori bulunamadı", robots: { index: false } };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<ListingQuery> }) {
  const [category, query] = await Promise.all([getCategory((await params).slug), searchParams]);
  if (!category) notFound();
  const filters = parseListing(query);
  const categoryIds = [category.id, ...category.children.map((child) => child.id)];
  const where = listingWhere(filters, { categoryId: { in: categoryIds } });
  const [brands, rows, total] = await Promise.all([
    prisma.brand.findMany({ where: { active: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where, include: { seller: true }, orderBy: listingOrder(filters.sort), skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.product.count({ where }),
  ]);
  const breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000" }, { "@type": "ListItem", position: 2, name: category.name, item: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/kategori/${category.slug}` }] };

  return <main className="min-h-screen bg-slate-50"><StorefrontHeader initialQuery={filters.q} /><section className="mx-auto max-w-7xl px-5 py-10"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} /><nav aria-label="İçerik yolu" className="text-sm text-slate-600"><Link href="/">Ana Sayfa</Link>{category.parent && <> / <Link href={`/kategori/${category.parent.slug}`}>{category.parent.name}</Link></>} / {category.name}</nav><h1 className="mt-4 text-4xl font-black">{category.name}</h1>{category.children.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{category.children.map((child) => <Link key={child.slug} href={`/kategori/${child.slug}`} className="rounded-full border bg-white px-4 py-2">{child.name}</Link>)}</div>}<div className="mt-7"><ListingControls action={`/kategori/${category.slug}`} query={query} brands={brands} /></div>{rows.length > 0 ? <><p className="mt-8 text-sm text-slate-500">{total} ürün bulundu.</p><div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{rows.map((product) => <ProductCard key={product.id} product={toStoreProduct(product)} />)}</div><Pagination path={`/kategori/${category.slug}`} query={query} page={filters.page} total={total} /></> : <p className="mt-8 rounded-2xl border bg-white p-10">Bu kategoride filtrelere uygun ürün bulunmuyor.</p>}</section><StorefrontFooter /></main>;
}
