import { NextRequest, NextResponse } from "next/server";
import { getCatalogProductsOrFallback } from "../../lib/product-data";

function normalize(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
  let products = await getCatalogProductsOrFallback();

  if (category) products = products.filter((product) => product.category === category);
  if (query) {
    const normalizedQuery = normalize(query);
    products = products.filter((product) =>
      [product.name, product.brand, product.category, product.shortDescription].some((value) => normalize(value).includes(normalizedQuery)),
    );
  }

  return NextResponse.json(products);
}
