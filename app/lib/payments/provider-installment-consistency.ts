import "server-only";

import type { InstallmentCount } from "../installment-policy";
import { parseInstallmentCount } from "../installment-policy";
import type { PaymentIntentInput } from "./types";

export type PersistedPaymentIntentSource = Readonly<{
  orderId: string;
  amount: { toString(): string } | string;
  currency: string;
  idempotencyKey: string | null;
  selectedInstallmentCount: number | null;
}>;

export class ProviderInstallmentConsistencyError extends Error {
  constructor(readonly code: "PAYMENT_IDEMPOTENCY_KEY_MISSING" | "INVALID_PROVIDER_CONFIRMED_INSTALLMENT") {
    super(code);
  }
}

export function paymentIntentFromPersistedPayment(payment: PersistedPaymentIntentSource): PaymentIntentInput {
  if (!payment.idempotencyKey) throw new ProviderInstallmentConsistencyError("PAYMENT_IDEMPOTENCY_KEY_MISSING");
  let selectedInstallmentCount: InstallmentCount | undefined;
  if (payment.selectedInstallmentCount !== null) {
    try {
      selectedInstallmentCount = parseInstallmentCount(payment.selectedInstallmentCount);
    } catch {
      throw new ProviderInstallmentConsistencyError("INVALID_PROVIDER_CONFIRMED_INSTALLMENT");
    }
  }
  return Object.freeze({
    orderId: payment.orderId,
    amount: payment.amount.toString(),
    currency: payment.currency,
    idempotencyKey: payment.idempotencyKey,
    ...(selectedInstallmentCount === undefined ? {} : { selectedInstallmentCount }),
  });
}

export function parseProviderConfirmedInstallmentCount(raw: unknown): InstallmentCount {
  try {
    if (typeof raw !== "number") throw new Error("INVALID_PROVIDER_CONFIRMED_INSTALLMENT");
    return parseInstallmentCount(raw);
  } catch {
    throw new ProviderInstallmentConsistencyError("INVALID_PROVIDER_CONFIRMED_INSTALLMENT");
  }
}
