import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";

const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("APPROVE") }), z.object({ action: z.literal("REJECT"), reason: z.string().trim().min(3).max(500) }), z.object({ action: z.literal("SUSPEND"), reason: z.string().trim().min(3).max(500) })]);
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 }); if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Geçersiz moderasyon işlemi." }, { status: 400 });
  const { id } = await params; const current = await prisma.product.findUnique({ where: { id }, select: { moderationStatus: true, catalogProductId: true } }); if (!current) return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  const target = parsed.data.action === "APPROVE" ? "APPROVED" : parsed.data.action === "REJECT" ? "REJECTED" : "SUSPENDED"; const reason = "reason" in parsed.data ? parsed.data.reason : null; const moderatedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { moderationStatus: target, moderationReason: reason, moderatedAt } });
    if (current.catalogProductId) await tx.catalogProduct.update({ where: { id: current.catalogProductId }, data: { moderationStatus: target, moderationReason: reason, moderatedAt } });
    await tx.adminAuditLog.create({ data: { actorUserId: session.user.id, action: `PRODUCT_${target}`, entityType: "PRODUCT", entityId: id, fromStatus: current.moderationStatus, toStatus: target, note: reason } });
  });
  return NextResponse.json({ ok: true, status: target });
}
