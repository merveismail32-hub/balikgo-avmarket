import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { toStoreProduct } from "@/app/lib/product-data";
import { publicProductPolicy } from "@/app/lib/product-visibility";
import { ensureCatalogForProduct } from "@/app/lib/catalog-sync";
import { revalidateOffer } from "@/app/lib/buybox";
import { formatPrice } from "@/app/lib/products";

const offerSelection = { id: true, catalogProductId: true, sellerId: true, price: true, stock: true, active: true, handlingTimeDays: true, seller: { select: { status: true } }, catalogProduct: { select: { id: true, active: true, moderationStatus: true } } } as const;
type OfferForValidation = Prisma.SellerOfferGetPayload<{ select: typeof offerSelection }>;
function offerIsEligible(offer: OfferForValidation | null, quantity = 1): offer is OfferForValidation {
  if (!offer) return false;
  return revalidateOffer(offer.catalogProduct, { ...offer, price: Number(offer.price), sellerStatus: offer.seller.status }, quantity).eligible;
}

async function getUserId() { const session = await auth(); return session?.user?.id ?? null; }
async function responseFor(userId: string) {
  const items = await prisma.cartItem.findMany({ where: { userId }, include: { product: { include: { seller: true } }, sellerOffer: { select: offerSelection } }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(items.map((item) => {
    const base = toStoreProduct(item.product);
    const available = offerIsEligible(item.sellerOffer, item.quantity);
    return { ...base, catalogProductId: item.catalogProductId ?? undefined, sellerOfferId: item.sellerOfferId ?? undefined, unitPrice: item.sellerOffer ? Number(item.sellerOffer.price) : base.unitPrice, price: item.sellerOffer ? formatPrice(Number(item.sellerOffer.price)) : base.price, stock: item.sellerOffer?.stock ?? base.stock, sellerName: item.product.seller.storeName, offerAvailable: available, quantity: item.quantity };
  }));
}
export async function GET() { const userId = await getUserId(); return userId ? responseFor(userId) : NextResponse.json({ error: "Oturum gerekli." }, { status: 401 }); }
export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const items = Array.isArray(body) ? body : [];
  for (const item of items) {
    const value = item as { id?: unknown; quantity?: unknown };
    if (typeof value.id !== "string") continue;
    await prisma.$transaction((tx) => ensureCatalogForProduct(tx, value.id as string));
    const product = await prisma.product.findFirst({ where: { id: value.id, ...publicProductPolicy }, select: { catalogProductId: true, sellerOffer: { select: offerSelection } } });
    const offer = product?.sellerOffer ?? null;
    if (!product?.catalogProductId || !offerIsEligible(offer)) continue;
    const requested = typeof value.quantity === "number" && Number.isInteger(value.quantity) ? Math.max(1, value.quantity) : 1;
    const quantity = Math.min(requested, offer.stock);
    const existing = await prisma.cartItem.findUnique({ where: { userId_productId: { userId, productId: value.id } } });
    await prisma.cartItem.upsert({ where: { userId_productId: { userId, productId: value.id } }, create: { userId, productId: value.id, catalogProductId: product.catalogProductId, sellerOfferId: offer.id, quantity }, update: { catalogProductId: product.catalogProductId, sellerOfferId: offer.id, quantity: Math.max(existing?.quantity ?? 0, quantity) } });
  }
  return responseFor(userId);
}
export async function PATCH(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const body = await request.json().catch(() => null) as { productId?: unknown; quantity?: unknown } | null;
  if (!body || typeof body.productId !== "string" || typeof body.quantity !== "number" || !Number.isInteger(body.quantity) || body.quantity < 1) return NextResponse.json({ error: "Geçersiz sepet verisi." }, { status: 400 });
  const product = await prisma.product.findFirst({ where: { id: body.productId, ...publicProductPolicy }, select: { sellerOffer: { select: offerSelection } } });
  const offer = product?.sellerOffer ?? null;
  if (!offerIsEligible(offer, body.quantity)) return NextResponse.json({ error: "Seçili satıcı teklifi artık uygun değil." }, { status: 409 });
  await prisma.cartItem.updateMany({ where: { userId, productId: body.productId }, data: { quantity: Math.min(body.quantity, offer.stock) } });
  return responseFor(userId);
}
export async function DELETE(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const productId = new URL(request.url).searchParams.get("productId");
  if (productId) await prisma.cartItem.deleteMany({ where: { userId, productId } }); else await prisma.cartItem.deleteMany({ where: { userId } });
  return responseFor(userId);
}
