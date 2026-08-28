import "server-only";
import type { MarketplacePaymentAdapter, PaymentProviderStatusLookup } from "./types";
import { TestPaymentAdapter } from "./test-adapter";

export function paymentAdapterFor(provider: string): MarketplacePaymentAdapter | null {
  if (provider === "TEST") return new TestPaymentAdapter();
  return null;
}

export function paymentStatusLookupFor(provider: string): PaymentProviderStatusLookup | null {
  // Provider integrations opt in here when they can return authoritative payment truth.
  void provider;
  return null;
}

// Compatibility belongs to the provider boundary, not the payment state machine.
export function paymentProviderMatches(storedProvider: string, eventProvider: string) {
  return storedProvider === eventProvider || (storedProvider === "TEST_PENDING" && eventProvider === "TEST");
}

export type { MarketplacePaymentAdapter, PaymentIntentInput, ObservedProviderPayment, ObservedProviderPaymentStatus, PaymentProviderStatusLookup, VerifiedPaymentEvent } from "./types";
