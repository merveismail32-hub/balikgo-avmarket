import { NextResponse } from "next/server";
import { getCatalogProductByIdOrFallback } from "../../../lib/product-data";

export async function GET(_: Request, { params }: RouteContext<"/api/products/[id]">) {
  const { id } = await params;
  const product = await getCatalogProductByIdOrFallback(id);
  return product ? NextResponse.json(product) : NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
}
