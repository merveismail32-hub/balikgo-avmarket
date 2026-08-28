import "server-only";
import type { MarketplacePaymentAdapter } from "./types";
import { TestPaymentAdapter } from "./test-adapter";

export function paymentAdapterFor(provider: string): MarketplacePaymentAdapter | null {
  if (provider === "TEST") return new TestPaymentAdapter();
  return null;
}

// Compatibility belongs to the provider boundary, not the payment state machine.
export function paymentProviderMatches(storedProvider: string, eventProvider: string) {
  return storedProvider === eventProvider || (storedProvider === "TEST_PENDING" && eventProvider === "TEST");
}

export type { MarketplacePaymentAdapter, PaymentIntentInput, VerifiedPaymentEvent } from "./types";
