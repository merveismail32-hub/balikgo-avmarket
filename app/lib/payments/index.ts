import "server-only";
import type { MarketplacePaymentAdapter } from "./types";
import { TestPaymentAdapter } from "./test-adapter";

export function paymentAdapterFor(provider: string): MarketplacePaymentAdapter | null {
  if (provider === "TEST") return new TestPaymentAdapter();
  return null;
}

export type { MarketplacePaymentAdapter, PaymentIntentInput, VerifiedPaymentEvent } from "./types";
