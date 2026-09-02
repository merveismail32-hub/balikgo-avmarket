import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { reviewSellerOnboarding, SellerOnboardingError } from "@/app/lib/seller-onboarding";
import { prisma } from "@/app/lib/prisma";
import { adminSellerApplicationSummarySelect, toAdminSellerApplicationSummaryDto } from "@/app/lib/admin-seller-application-dto";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_review") }).strict(),
  z.object({ action: z.literal("approve") }).strict(),
  z.object({ action: z.literal("request_revision"), reason: z.string().trim().min(2).max(500) }).strict(),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(2).max(500) }).strict(),
]);

function failure(error: unknown) {
  if (error instanceof SellerOnboardingError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "INCOMPLETE" ? 400 : 409;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error("[admin-seller-onboarding] İşlem tamamlanamadı.", error instanceof Error ? error.name : "UNKNOWN");
  return NextResponse.json({ error: "İnceleme işlemi tamamlanamadı." }, { status: 503 });
}

export async function GET(_request: Request, { params }: RouteContext<"/api/admin/seller-applications/[id]">) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const application = await prisma.sellerProfile.findUnique({ where: { id: (await params).id }, select: adminSellerApplicationSummarySelect });
  return application ? NextResponse.json(toAdminSellerApplicationSummaryDto(application)) : NextResponse.json({ error: "Başvuru bulunamadı." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/admin/seller-applications/[id]">) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Geçersiz yönetici işlemi." }, { status: 400 });
    const action = parsed.data.action === "start_review" ? "START_REVIEW" : parsed.data.action === "request_revision" ? "REQUEST_REVISION" : parsed.data.action === "approve" ? "APPROVE" : "REJECT";
    const result = await reviewSellerOnboarding({ sellerId: (await params).id, reviewerUserId: session.user.id, action, reason: "reason" in parsed.data ? parsed.data.reason : undefined, idempotencyKey: request.headers.get("idempotency-key")?.slice(0, 191) || `admin-review-${randomUUID()}` });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return failure(error); }
}
