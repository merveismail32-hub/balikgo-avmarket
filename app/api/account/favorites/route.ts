import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { toStoreProduct } from "@/app/lib/product-data";
import { publicProductPolicy } from "@/app/lib/product-visibility";

async function getUserId() { const session = await auth(); return session?.user?.id ?? null; }
async function responseFor(userId: string) {
  const favorites = await prisma.favorite.findMany({ where: { userId, product: publicProductPolicy }, include: { product: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(favorites.map((favorite) => toStoreProduct(favorite.product)));
}
export async function GET() { const userId = await getUserId(); return userId ? responseFor(userId) : NextResponse.json({ error: "Oturum gerekli." }, { status: 401 }); }
export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const requestedIds = Array.isArray(body) ? body.filter((id): id is string => typeof id === "string") : [];
  const products = await prisma.product.findMany({ where: { id: { in: requestedIds }, ...publicProductPolicy }, select: { id: true } });
  for (const { id: productId } of products) await prisma.favorite.upsert({ where: { userId_productId: { userId, productId } }, create: { userId, productId }, update: {} });
  return responseFor(userId);
}
export async function DELETE(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "Ürün gerekli." }, { status: 400 });
  await prisma.favorite.deleteMany({ where: { userId, productId } });
  return responseFor(userId);
}
