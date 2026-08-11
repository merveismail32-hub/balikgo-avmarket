import type { PaymentStatus } from "@prisma/client";

export type VerifiedPaymentEvent = { eventId: string; paymentId: string; eventType: "PAYMENT_PAID" | "PAYMENT_FAILED"; amount: string; currency: string; providerPaymentId?: string };
export type PaymentIntentInput = { orderId: string; amount: string; currency: string; idempotencyKey: string };

export interface MarketplacePaymentAdapter {
  readonly name: string;
  createPayment(input: PaymentIntentInput): Promise<{ status: PaymentStatus; providerPaymentId?: string }>;
  verifyPayment(providerPaymentId: string): Promise<{ status: PaymentStatus }>;
  cancelPayment(providerPaymentId: string): Promise<{ status: PaymentStatus }>;
  refundPayment(input: { providerPaymentId: string; amount: string; currency: string; idempotencyKey: string }): Promise<{ providerRefundId: string; status: "PROCESSING" | "COMPLETED" }>;
  verifyAndParseWebhook(request: Request, rawBody: string): Promise<VerifiedPaymentEvent>;
}
