import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { decideRefund } from "@/app/lib/order-orchestrator";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz iade kararı." }, { status: 400 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction((tx) => decideRefund(tx, { refundId: id, actorUserId: session.user.id, decision: parsed.data.decision }));
    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "İade kaydı bulunamadı." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INVALID_STATE" || message === "CONCURRENT_CHANGE") return NextResponse.json({ error: "İade talebi mevcut durumunda bu işlem için uygun değil." }, { status: 409 });
    console.error("[admin-refund] failed", { refundId: id, code: (error as { code?: string }).code });
    return NextResponse.json({ error: "İade talebi güncellenemedi." }, { status: 500 });
  }
}
