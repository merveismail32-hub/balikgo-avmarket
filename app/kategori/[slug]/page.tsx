import { CategoryListing } from "../../components/category-listing";
import { getCatalogProductsOrFallback } from "../../lib/product-data";
import { getCategoryBySlug } from "../../lib/products";

export default async function CategoryPage({ params }: PageProps<"/kategori/[slug]">) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  const products = await getCatalogProductsOrFallback();
  const categoryProducts = category ? products.filter((product) => product.category === category.name) : [];

  return <CategoryListing slug={slug} initialProducts={categoryProducts} />;
}
