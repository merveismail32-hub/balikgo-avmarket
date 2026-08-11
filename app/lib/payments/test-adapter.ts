import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { MarketplacePaymentAdapter, VerifiedPaymentEvent } from "./types";

const eventSchema = z.object({ eventId: z.string().min(8).max(191), paymentId: z.string().min(1), eventType: z.enum(["PAYMENT_PAID", "PAYMENT_FAILED"]), amount: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.literal("TRY"), providerPaymentId: z.string().max(191).optional() }).strict();

export class TestPaymentAdapter implements MarketplacePaymentAdapter {
  readonly name = "TEST";
  private assertEnabled() {
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_TEST_PAYMENT_ADAPTER !== "true") throw new Error("TEST_PROVIDER_DISABLED");
  }
  async createPayment() { this.assertEnabled(); return { status: "PENDING" as const }; }
  async verifyPayment() { this.assertEnabled(); return { status: "PENDING" as const }; }
  async cancelPayment() { this.assertEnabled(); return { status: "CANCELLED" as const }; }
  async refundPayment(): Promise<{ providerRefundId: string; status: "PROCESSING" | "COMPLETED" }> { this.assertEnabled(); throw new Error("TEST_REFUND_NOT_IMPLEMENTED"); }
  async verifyAndParseWebhook(request: Request, rawBody: string): Promise<VerifiedPaymentEvent> {
    this.assertEnabled();
    const secret = process.env.TEST_PAYMENT_WEBHOOK_SECRET;
    if (!secret || secret.length < 24) throw new Error("WEBHOOK_SECRET_MISSING");
    const timestamp = request.headers.get("x-balikgo-timestamp") ?? "";
    const signature = request.headers.get("x-balikgo-signature") ?? "";
    if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) throw new Error("INVALID_SIGNATURE");
    const milliseconds = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
    if (Math.abs(Date.now() - milliseconds) > 5 * 60_000) throw new Error("STALE_WEBHOOK");
    const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
    const actual = Buffer.from(signature, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("INVALID_SIGNATURE");
    return eventSchema.parse(JSON.parse(rawBody));
  }
}
