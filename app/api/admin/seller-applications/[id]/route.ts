import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/app/lib/prisma";
import { isAdmin } from "@/app/lib/admin-auth";

const actionSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("approve") }), z.object({ action: z.literal("reject"), reason: z.string().trim().min(2).max(500) })]);
export async function PATCH(request: Request, { params }: RouteContext<"/api/admin/seller-applications/[id]">) {
  if (!await isAdmin()) return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz yönetici işlemi." }, { status: 400 });
  const { id } = await params;
  const profile = await prisma.sellerProfile.findUnique({ where: { id }, select: { userId: true } });
  if (!profile) return NextResponse.json({ error: "Başvuru bulunamadı." }, { status: 404 });
  if (parsed.data.action === "approve") {
    await prisma.$transaction([
      prisma.sellerProfile.update({ where: { id }, data: { status: "APPROVED", rejectionReason: null } }),
      prisma.user.update({ where: { id: profile.userId }, data: { role: "SELLER" } }),
    ]);
    return NextResponse.json({ ok: true, status: "APPROVED" });
  }
  await prisma.$transaction([
    prisma.sellerProfile.update({ where: { id }, data: { status: "REJECTED", rejectionReason: parsed.data.reason } }),
    prisma.user.update({ where: { id: profile.userId }, data: { role: "CUSTOMER" } }),
  ]);
  return NextResponse.json({ ok: true, status: "REJECTED" });
}
