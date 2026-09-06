import assert from "node:assert/strict";
import { paymentIntentFromPersistedPayment, ProviderInstallmentConsistencyError, parseProviderConfirmedInstallmentCount } from "../app/lib/payments/provider-installment-consistency";
import { TestPaymentAdapter } from "../app/lib/payments/test-adapter";

const persisted = { orderId: "order-1", amount: "100.00", currency: "TRY", idempotencyKey: "payment-attempt-1", selectedInstallmentCount: 1 as const };
assert.deepEqual(paymentIntentFromPersistedPayment(persisted), { orderId: "order-1", amount: "100.00", currency: "TRY", idempotencyKey: "payment-attempt-1", selectedInstallmentCount: 1 });
assert.deepEqual(paymentIntentFromPersistedPayment({ ...persisted, selectedInstallmentCount: null }), { orderId: "order-1", amount: "100.00", currency: "TRY", idempotencyKey: "payment-attempt-1" });
assert.throws(() => paymentIntentFromPersistedPayment({ ...persisted, selectedInstallmentCount: 3.5 }), ProviderInstallmentConsistencyError);
assert.throws(() => paymentIntentFromPersistedPayment({ ...persisted, idempotencyKey: null }), /PAYMENT_IDEMPOTENCY_KEY_MISSING/);
for (const count of [1, 3, 6, 9] as const) assert.equal(parseProviderConfirmedInstallmentCount(count), count);
for (const invalid of [0, -1, 2, 4, 12, 99, 1.5, Number.NaN, "3"]) assert.throws(() => parseProviderConfirmedInstallmentCount(invalid));

async function main() {
  const saved = { NODE_ENV: process.env.NODE_ENV, ENABLE_TEST_PAYMENT_ADAPTER: process.env.ENABLE_TEST_PAYMENT_ADAPTER };
  try {
    Object.assign(process.env, { NODE_ENV: "test", ENABLE_TEST_PAYMENT_ADAPTER: "true" });
    const adapter = new TestPaymentAdapter();
    await assert.doesNotReject(() => adapter.createPayment({ ...persisted }));
    await assert.rejects(() => adapter.createPayment({ ...persisted, selectedInstallmentCount: 3 }), /TEST_PROVIDER_INSTALLMENT_UNSUPPORTED/);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  console.log("PASS: persisted Payment is the sole provider request installment authority and provider confirmation validation is fail-closed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
