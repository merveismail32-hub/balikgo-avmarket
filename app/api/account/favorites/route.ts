import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { publicCatalogPolicy, toStoreCatalogProduct } from "@/app/lib/catalog-data";

async function getUserId() { const session = await auth(); return session?.user?.id ?? null; }
async function responseFor(userId: string) {
  const favorites = await prisma.favorite.findMany({
    where: { userId, catalogProduct: publicCatalogPolicy },
    include: { catalogProduct: { include: { categoryRecord: true, brandRecord: true, offers: { where: { active: true, seller: { status: "APPROVED" } }, include: { seller: true, legacyProduct: true }, orderBy: [{ price: "asc" }, { createdAt: "asc" }] } } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(favorites.map((favorite) => favorite.catalogProduct ? toStoreCatalogProduct(favorite.catalogProduct) : null).filter(Boolean));
}
export async function GET() { const userId = await getUserId(); return userId ? responseFor(userId) : NextResponse.json({ error: "Oturum gerekli." }, { status: 401 }); }
export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const requestedIds = Array.isArray(body) ? body.filter((id): id is string => typeof id === "string") : [];
  const products = await prisma.product.findMany({ where: { id: { in: requestedIds }, catalogProduct: publicCatalogPolicy }, select: { id: true, catalogProductId: true } });
  for (const product of products) {
    if (!product.catalogProductId) continue;
    const existing = await prisma.favorite.findFirst({ where: { userId, catalogProductId: product.catalogProductId }, select: { id: true } });
    if (!existing) await prisma.favorite.create({ data: { userId, productId: product.id, catalogProductId: product.catalogProductId } });
  }
  return responseFor(userId);
}
export async function DELETE(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "Ürün gerekli." }, { status: 400 });
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { catalogProductId: true } });
  await prisma.favorite.deleteMany({ where: { userId, ...(product?.catalogProductId ? { catalogProductId: product.catalogProductId } : { productId }) } });
  return responseFor(userId);
}
