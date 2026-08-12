import type { Metadata } from "next";
import Link from "next/link";
import { ListingControls, Pagination } from "@/app/components/listing-controls";
import { ProductCard } from "@/app/components/product-card";
import { StorefrontFooter } from "@/app/components/storefront-footer";
import { StorefrontHeader } from "@/app/components/storefront-header";
import {
  PAGE_SIZE,
  parseListing,
  type ListingQuery,
} from "@/app/lib/listing";
import { toStoreProduct } from "@/app/lib/product-data";
import { listPublicCatalog } from "@/app/lib/catalog-data";
import { prisma } from "@/app/lib/prisma";

export const metadata: Metadata = {
  title: "Ürün Ara",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<ListingQuery>;
}) {
  const query = await searchParams;
  const filters = parseListing(query);
  const hasCriteria = Boolean(
    filters.q ||
      filters.category ||
      filters.brand ||
      filters.minPrice !== null ||
      filters.maxPrice !== null ||
      filters.inStock ||
      filters.rating,
  );
  const [categories, brands, catalogResult] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: { active: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    hasCriteria
      ? listPublicCatalog({ ...filters, skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE })
      : Promise.resolve({ products: [], total: 0 }),
  ]);
  const { products: rows, total } = catalogResult;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <StorefrontHeader initialQuery={filters.q} />
      <section className="mx-auto max-w-7xl px-5 py-10">
        <h1 className="text-4xl font-black">Ürün ara</h1>
        <p className="mt-2 text-slate-600">
          Ürün, marka, kategori veya stok koduna göre arayın.
        </p>
        <div className="mt-7">
          <ListingControls action="/arama" query={query} categories={categories} brands={brands} />
        </div>
        {!hasCriteria ? (
          <div className="mt-8 rounded-2xl border bg-white p-10 text-center">
            Aramaya başlamak için bir kelime veya filtre girin.
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-8 rounded-2xl border bg-white p-10 text-center">
            <h2 className="text-2xl font-black">Ürün bulunamadı</h2>
            <p className="mt-2 text-slate-500">Filtreleri değiştirerek yeniden deneyebilirsiniz.</p>
            <Link href="/arama" className="mt-5 inline-block font-bold text-sky-700">Filtreleri temizle</Link>
          </div>
        ) : (
          <>
            <p className="mt-8 text-sm text-slate-500">{total} ürün bulundu.</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {rows.map((product) => <ProductCard key={product.id} product={toStoreProduct(product)} />)}
            </div>
            <Pagination path="/arama" query={query} page={filters.page} total={total} />
          </>
        )}
      </section>
      <StorefrontFooter />
    </main>
  );
}
