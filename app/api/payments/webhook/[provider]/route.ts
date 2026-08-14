import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { paymentAdapterFor } from "@/app/lib/payments";
import { isDuplicatePaymentEventConflict, processVerifiedPaymentEvent } from "@/app/lib/payment-orchestrator";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toUpperCase();
  const adapter = paymentAdapterFor(provider);
  if (!adapter) return NextResponse.json({ error: "Ödeme sağlayıcısı desteklenmiyor." }, { status: 404 });
  const rawBody = await request.text();
  try {
    const event = await adapter.verifyAndParseWebhook(request, rawBody);
    const result = await prisma.$transaction((tx) => processVerifiedPaymentEvent(tx, {
      provider,
      event,
      payloadHash: createHash("sha256").update(rawBody).digest("hex"),
    }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (isDuplicatePaymentEventConflict(error)) return NextResponse.json({ ok: true, duplicate: true });
    if (["TEST_PROVIDER_DISABLED", "WEBHOOK_SECRET_MISSING", "INVALID_SIGNATURE", "STALE_WEBHOOK"].includes(code)) return NextResponse.json({ error: "Webhook doğrulanamadı." }, { status: 401 });
    if (code === "PAYMENT_NOT_FOUND") return NextResponse.json({ error: "Ödeme kaydı bulunamadı." }, { status: 404 });
    if (code === "AMOUNT_MISMATCH" || code === "PAYMENT_MISMATCH") return NextResponse.json({ error: "Ödeme bilgileri beklenen siparişle eşleşmiyor." }, { status: 409 });
    console.error("[payment-webhook] processing failed", { provider, code: (error as { code?: string }).code });
    return NextResponse.json({ error: "Ödeme doğrulanamadı." }, { status: 500 });
  }
}
