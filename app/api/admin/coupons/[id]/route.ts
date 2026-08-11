import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";

const schema = z.object({ active: z.boolean().optional(), startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional(), minimumAmount: z.coerce.number().min(0).nullable().optional(), maxDiscount: z.coerce.number().positive().nullable().optional(), usageLimit: z.coerce.number().int().positive().nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "En az bir alan gerekli.");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz kupon bilgisi." }, { status: 400 });
  const { id } = await params;
  const current = await prisma.coupon.findUnique({ where: { id }, select: { active: true, startsAt: true, endsAt: true, usageCount: true } });
  if (!current) return NextResponse.json({ error: "Kupon bulunamadı." }, { status: 404 });
  if (parsed.data.usageLimit != null && parsed.data.usageLimit < current.usageCount) return NextResponse.json({ error: "Kullanım limiti geçmiş kullanım sayısından düşük olamaz." }, { status: 409 });
  const startsAt = parsed.data.startsAt === undefined ? current.startsAt : parsed.data.startsAt;
  const endsAt = parsed.data.endsAt === undefined ? current.endsAt : parsed.data.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) return NextResponse.json({ error: "Bitiş tarihi başlangıç tarihinden sonra olmalıdır." }, { status: 400 });
  await prisma.$transaction([prisma.coupon.update({ where: { id }, data: parsed.data }), prisma.adminAuditLog.create({ data: { actorUserId: session.user.id, action: "COUPON_UPDATED", entityType: "COUPON", entityId: id, fromStatus: current.active ? "ACTIVE" : "INACTIVE", toStatus: parsed.data.active === undefined ? undefined : parsed.data.active ? "ACTIVE" : "INACTIVE" } })]);
  return NextResponse.json({ ok: true });
}
