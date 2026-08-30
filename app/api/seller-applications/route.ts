import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOwnSellerOnboarding, saveAndSubmitSellerOnboarding, sellerOnboardingDraftSchema, SellerOnboardingError } from "@/app/lib/seller-onboarding";

function errorResponse(error: unknown) {
  if (error instanceof SellerOnboardingError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" || error.code === "INVALID_STATE" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error("[seller-onboarding] İşlem tamamlanamadı.", error instanceof Error ? error.name : "UNKNOWN");
  return NextResponse.json({ error: "Başvuru hizmetine şu anda ulaşılamıyor." }, { status: 503 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const application = await getOwnSellerOnboarding(session.user.id);
  return application ? NextResponse.json(application) : NextResponse.json({ error: "Başvuru bulunamadı." }, { status: 404 });
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Başvuru için giriş yapmalısınız." }, { status: 401 });
    const parsed = sellerOnboardingDraftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Zorunlu işletme, yetkili ve KYB alanlarını doğrulayın.", issues: parsed.error.issues.map(({ path, code }) => ({ path, code })) }, { status: 400 });
    const application = await saveAndSubmitSellerOnboarding({ userId: session.user.id, data: parsed.data, idempotencyKey: request.headers.get("idempotency-key")?.slice(0, 191) || `seller-submit-${randomUUID()}` });
    return NextResponse.json({ ok: true, application }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
