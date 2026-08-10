import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";

const sellerApplicationSchema = z.object({
  storeName: z.string().trim().min(2), companyType: z.string().trim().min(2), taxNumber: z.string().trim().min(5), taxOffice: z.string().trim().min(2), city: z.string().trim().min(2), address: z.string().trim().min(10), description: z.string().trim().min(20), categories: z.string().trim().min(2), phone: z.string().trim().min(10), acceptedTerms: z.literal(true),
});
function slugify(value: string) { return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Başvuru için giriş yapmalısınız." }, { status: 401 });
    const parsed = sellerApplicationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Lütfen tüm zorunlu alanları doğru doldurun ve sözleşmeyi onaylayın." }, { status: 400 });
    const existingProfile = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (existingProfile) return NextResponse.json({ error: "Bu hesap için zaten bir satıcı başvurusu bulunuyor." }, { status: 409 });
    const baseSlug = slugify(parsed.data.storeName) || "magaza";
    let storeSlug = baseSlug; let index = 2;
    while (await prisma.sellerProfile.findUnique({ where: { storeSlug }, select: { id: true } })) storeSlug = `${baseSlug}-${index++}`;
    const { acceptedTerms: _, ...application } = parsed.data;
    await prisma.$transaction([
      prisma.sellerProfile.create({ data: { userId: session.user.id, storeSlug, ...application } }),
      prisma.user.update({ where: { id: session.user.id }, data: { phone: application.phone } }),
    ]);
    return NextResponse.json({ ok: true, status: "PENDING" }, { status: 201 });
  } catch (error) {
    console.error("[seller-application] Başvuru kaydedilemedi.", error);
    return NextResponse.json({ error: "Başvuru hizmetine şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin." }, { status: 503 });
  }
}
