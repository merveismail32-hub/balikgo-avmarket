import { auth } from "@/auth";
import { getAdminInstallmentAuditTimeline, getAdminInstallmentOverview, InstallmentReadModelError } from "@/app/lib/installment-read-model";
import { NextResponse } from "next/server";
import { z } from "zod";

const querySchema = z.object({ sellerId: z.string().min(1).optional(), cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).optional(), includeAudit: z.enum(["true", "false"]).optional(), auditOffset: z.coerce.number().int().min(0).max(500).optional(), offerId: z.string().min(1).optional(), amount: z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).optional() }).strict();
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sorgu." }, { status: 400 });
  try {
    const overview = await getAdminInstallmentOverview({ actorUserId: session.user.id, ...parsed.data });
    const audit = parsed.data.includeAudit === "true" && parsed.data.sellerId ? await getAdminInstallmentAuditTimeline({ actorUserId: session.user.id, sellerId: parsed.data.sellerId, limit: parsed.data.limit, offset: parsed.data.auditOffset }) : null;
    return NextResponse.json({ overview, audit });
  } catch (error) {
    if (error instanceof InstallmentReadModelError) return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Yönetici yetkisi gerekli." : "Read model bulunamadı." }, { status: error.code === "FORBIDDEN" ? 403 : 404 });
    throw error;
  }
}
