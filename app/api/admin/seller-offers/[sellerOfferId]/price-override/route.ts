import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { AdminPriceOverrideError, overrideSellerOfferPriceByAdmin } from "@/app/lib/admin-price-override";

const schema = z.object({ expectedPriceVersion: z.number().int().positive(), price: z.union([z.string().min(1).max(30), z.number()]), reason: z.string().trim().min(3).max(500) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ sellerOfferId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçerli fiyat, sürüm ve müdahale nedeni gerekli." }, { status: 400 });
  try {
    const { sellerOfferId } = await params;
    const result = await overrideSellerOfferPriceByAdmin({ actorUserId: session.user.id, sellerOfferId, ...parsed.data });
    return NextResponse.json({ changed: result.changed, price: result.price.toFixed(2), priceVersion: result.priceVersion, priceAnomalyHeld: result.priceAnomalyHeld, auditId: result.auditId, ...(result.changed ? { anomaly: result.anomaly } : {}) });
  } catch (error) {
    if (error instanceof AdminPriceOverrideError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "OFFER_NOT_FOUND" ? 404 : error.code === "STALE_PRICE_VERSION" ? 409 : 400;
      return NextResponse.json({ error: status === 409 ? "Fiyat eşzamanlı olarak değişti; güncel sürümü yeniden yükleyin." : "Fiyat müdahalesi uygulanamadı." }, { status });
    }
    throw error;
  }
}
