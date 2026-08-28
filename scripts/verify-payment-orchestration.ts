import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { processPaymentCallback, processVerifiedPaymentEvent } from "../app/lib/payment-orchestrator";
import { paymentAdapterFor, paymentProviderMatches } from "../app/lib/payments";
import { TestPaymentAdapter } from "../app/lib/payments/test-adapter";

const input = { provider: "OPAQUE_PROVIDER", event: { eventId: "event-123", paymentId: "payment-123", eventType: "PAYMENT_PAID" as const, amount: "10.00", currency: "TRY" } };
const dbError = (code: string, target?: string[]) => new Prisma.PrismaClientKnownRequestError("test", { code, clientVersion: "test", meta: target ? { target } : undefined });

async function verifyRetries() {
  for (const failure of [dbError("P2034"), dbError("P2002", ["provider", "providerEventId"])]) {
    let attempts = 0;
    const client = { $transaction: async () => { if (++attempts === 1) throw failure; return { duplicate: true }; } } as unknown as Pick<PrismaClient, "$transaction">;
    assert.deepEqual(await processPaymentCallback(client, input), { duplicate: true });
    assert.equal(attempts, 2);
  }
  for (const [failure, expectedAttempts] of [[dbError("P2034"), 3], [dbError("P2002", ["providerPaymentId"]), 1], [dbError("P1001"), 1], [new Error("PAYMENT_EVENT_CONFLICT"), 1]] as const) {
    let attempts = 0;
    const client = { $transaction: async () => { attempts++; throw failure; } } as unknown as Pick<PrismaClient, "$transaction">;
    await assert.rejects(processPaymentCallback(client, input), error => error === failure);
    assert.equal(attempts, expectedAttempts, "retry must be bounded and must not mask failures");
  }
  await assert.rejects(processVerifiedPaymentEvent({} as Prisma.TransactionClient, { ...input, event: { ...input.event, eventType: "UNKNOWN" as "PAYMENT_PAID" } }), /INVALID_PAYMENT_EVENT/);
}

async function verifyAdapter() {
  assert(paymentProviderMatches("TEST_PENDING", "TEST"));
  assert(paymentProviderMatches("OPAQUE_PROVIDER", "OPAQUE_PROVIDER"));
  assert(!paymentProviderMatches("OPAQUE_PROVIDER", "OTHER"));
  assert(!paymentProviderMatches("TEST_PENDING", "OTHER"));
  assert.equal(paymentAdapterFor("UNKNOWN"), null);
  const saved = { NODE_ENV: process.env.NODE_ENV, ENABLE_TEST_PAYMENT_ADAPTER: process.env.ENABLE_TEST_PAYMENT_ADAPTER, TEST_PAYMENT_WEBHOOK_SECRET: process.env.TEST_PAYMENT_WEBHOOK_SECRET };
  const secret = "unit-test-only-webhook-secret-not-a-credential";
  const adapter = new TestPaymentAdapter();
  const signed = (body: string, timestamp = String(Date.now())) => new Request("https://invalid.local/webhook", { method: "POST", headers: { "x-balikgo-timestamp": timestamp, "x-balikgo-signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex") } });
  try {
    Object.assign(process.env, { NODE_ENV: "test", ENABLE_TEST_PAYMENT_ADAPTER: "true", TEST_PAYMENT_WEBHOOK_SECRET: secret });
    const body = JSON.stringify(input.event);
    assert.deepEqual(await adapter.verifyAndParseWebhook(signed(body), body), input.event);
    await assert.rejects(adapter.verifyAndParseWebhook(signed(body), body.replace("10.00", "99.00")), /INVALID_SIGNATURE/);
    await assert.rejects(adapter.verifyAndParseWebhook(signed(body, String(Date.now() - 360_000)), body), /STALE_WEBHOOK/);
    await assert.rejects(adapter.verifyAndParseWebhook(signed("{"), "{"), SyntaxError);
    const unknown = JSON.stringify({ ...input.event, eventType: "UNKNOWN" });
    await assert.rejects(adapter.verifyAndParseWebhook(signed(unknown), unknown));
    Object.assign(process.env, { NODE_ENV: "production" });
    await assert.rejects(adapter.verifyAndParseWebhook(signed(body), body), /TEST_PROVIDER_DISABLED/);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

async function main() {
  await verifyRetries();
  await verifyAdapter();
  console.log("PASS: payment callback bounded retries, provider isolation, signed-event validation and production test-provider rejection");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
