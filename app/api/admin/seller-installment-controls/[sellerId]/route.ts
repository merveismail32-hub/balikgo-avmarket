import { auth } from "@/auth";
import { SellerInstallmentControlError, setSellerInstallmentAuthorization } from "@/app/lib/seller-installment-control";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  authorizationMode: z.enum(["DISABLED", "REQUEST_ONLY", "DELEGATED"]),
  delegatedAllowedInstallments: z.array(z.unknown()).min(1),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
}).strict();

function errorResponse(error: unknown) {
  if (!(error instanceof SellerInstallmentControlError)) throw error;
  if (error.code === "FORBIDDEN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  if (error.code === "SELLER_NOT_FOUND") return NextResponse.json({ error: "Satıcı bulunamadı." }, { status: 404 });
  if (error.code === "STALE_VERSION" || error.code === "CONCURRENT_CHANGE") return NextResponse.json({ error: "Taksit yetkisi eşzamanlı olarak değişti." }, { status: 409 });
  return NextResponse.json({ error: "Geçersiz taksit yetkisi." }, { status: 400 });
}

export async function PUT(request: Request, context: { params: Promise<{ sellerId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz taksit yetkisi." }, { status: 400 });
  const { sellerId } = await context.params;
  try {
    return NextResponse.json(await setSellerInstallmentAuthorization({ actorUserId: session.user.id, sellerId, ...parsed.data }));
  } catch (error) { return errorResponse(error); }
}
