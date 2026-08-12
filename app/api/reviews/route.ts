import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { publicCatalogPolicy } from "@/app/lib/catalog-data";

const schema = z.object({ orderItemId: z.string().min(1), rating: z.number().int().min(1).max(5), comment: z.string().trim().min(10).max(2000) }).strict();

export async function POST(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Puan 1-5 arasında olmalı ve yorum en az 10 karakter olmalıdır." }, { status: 400 });
  const item = await prisma.orderItem.findFirst({ where: { id: parsed.data.orderItemId, status: { in: ["DELIVERED", "COMPLETED"] }, order: { userId: session.user.id } }, select: { productId: true, catalogProductId: true } });
  if (!item?.catalogProductId) return NextResponse.json({ error: "Yalnızca katalogla eşleşmiş teslim edilmiş satın alımlar değerlendirilebilir." }, { status: 403 });
  try {
    const review = await prisma.review.create({ data: { userId: session.user.id, productId: item.productId, catalogProductId: item.catalogProductId, orderItemId: parsed.data.orderItemId, rating: parsed.data.rating, comment: parsed.data.comment } });
    return NextResponse.json({ id: review.id, status: review.status }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return NextResponse.json({ error: "Bu ürün için değerlendirmeniz daha önce alınmış." }, { status: 409 });
    throw error;
  }
}

export async function GET(request: Request) {
  const requestedId = new URL(request.url).searchParams.get("productId");
  if (!requestedId) return NextResponse.json({ error: "Ürün gerekli." }, { status: 400 });
  const catalog = await prisma.catalogProduct.findFirst({ where: { ...publicCatalogPolicy, OR: [{ id: requestedId }, { legacyProducts: { some: { id: requestedId } } }] }, select: { id: true } });
  if (!catalog) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  const session = await auth();
  const [reviews, eligibleItem, existing] = await Promise.all([
    prisma.review.findMany({ where: { catalogProductId: catalog.id, status: "APPROVED" }, select: { id: true, rating: true, comment: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    session?.user?.id ? prisma.orderItem.findFirst({ where: { catalogProductId: catalog.id, status: { in: ["DELIVERED", "COMPLETED"] }, order: { userId: session.user.id }, review: null }, select: { id: true }, orderBy: { createdAt: "desc" } }) : null,
    session?.user?.id ? prisma.review.findFirst({ where: { catalogProductId: catalog.id, userId: session.user.id }, select: { id: true } }) : null,
  ]);
  return NextResponse.json({ reviews, eligibleOrderItemId: eligibleItem?.id ?? null, alreadyReviewed: Boolean(existing) });
}
