import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";

const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("APPROVE") }), z.object({ action: z.literal("REJECT"), reason: z.string().trim().min(3).max(500) })]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz yorum moderasyonu." }, { status: 400 });
  const { id } = await params;
  const review = await prisma.review.findUnique({ where: { id }, select: { status: true, productId: true, catalogProductId: true } });
  if (!review) return NextResponse.json({ error: "Yorum bulunamadı." }, { status: 404 });
  const target = parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED";
  await prisma.$transaction(async (tx) => {
    await tx.review.update({ where: { id }, data: { status: target, moderationReason: "reason" in parsed.data ? parsed.data.reason : null } });
    const aggregate = await tx.review.aggregate({ where: { ...(review.catalogProductId ? { catalogProductId: review.catalogProductId } : { productId: review.productId }), status: "APPROVED" }, _avg: { rating: true }, _count: { _all: true } });
    const rating = aggregate._avg.rating ?? 0; const reviewCount = aggregate._count._all;
    await tx.product.update({ where: { id: review.productId }, data: { rating, reviewCount } });
    if (review.catalogProductId) await tx.catalogProduct.update({ where: { id: review.catalogProductId }, data: { rating, reviewCount } });
    await tx.adminAuditLog.create({ data: { actorUserId: session.user.id, action: `REVIEW_${target}`, entityType: "REVIEW", entityId: id, fromStatus: review.status, toStatus: target, note: "reason" in parsed.data ? parsed.data.reason : null } });
  });
  return NextResponse.json({ ok: true, status: target });
}
