import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { cancelOrderItem, requestOrderItemReturn } from "@/app/lib/order-orchestrator";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CANCEL") }).strict(),
  z.object({ action: z.literal("REQUEST_RETURN"), reason: z.string().trim().min(10).max(500), quantity: z.number().int().min(1).optional(), idempotencyKey: z.string().uuid().optional() }).strict(),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz işlem." }, { status: 400 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (parsed.data.action === "CANCEL") return cancelOrderItem(tx, { orderItemId: id, actor: { kind: "CUSTOMER", userId: session.user.id } });
      return requestOrderItemReturn(tx, { orderItemId: id, userId: session.user.id, reason: parsed.data.reason, quantity: parsed.data.quantity, idempotencyKey: parsed.data.idempotencyKey });
    });
    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "Sipariş kalemi bulunamadı." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CARRIER_HANDOFF") return NextResponse.json({ error: "Bu ürün kargoya verildiği için artık iptal edilemez. Teslimattan sonra iade talebi oluşturabilirsiniz." }, { status: 409 });
    if (message === "RETURN_REQUIRED") return NextResponse.json({ error: "Teslim edilen ürünler iptal edilemez; iade talebi oluşturabilirsiniz." }, { status: 409 });
    if (["INVALID_ITEM_STATE", "INVALID_STATE", "CONCURRENT_CHANGE", "RETURN_QUANTITY_INVALID", "RETURN_QUANTITY_EXCEEDED", "RETURN_IDEMPOTENCY_CONFLICT"].includes(message)) return NextResponse.json({ error: "Bu sipariş kalemi mevcut durumunda bu işlem için uygun değil." }, { status: 409 });
    if (message === "PAYMENT_NOT_FOUND" || message === "PAYMENT_NOT_PAID") return NextResponse.json({ error: "Bu sipariş için uygun bir ödeme kaydı bulunamadı." }, { status: 409 });
    console.error("[customer-order-action] failed", { orderItemId: id, code: (error as { code?: string }).code });
    return NextResponse.json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, { status: 500 });
  }
}
