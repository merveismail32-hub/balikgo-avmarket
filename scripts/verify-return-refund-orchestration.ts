import assert from "node:assert/strict";
import { Prisma, type Refund } from "@prisma/client";
import { claimRefundExecution, executeClaimedRefund, finalizeRefundExecution, type PaymentRefundProvider } from "../app/lib/refund-orchestrator";

type TestRefund = Pick<Refund, "id" | "status" | "executionKey" | "providerRefundId" | "providerOutcome" | "providerObservedAt" | "amount" | "currency"> & { payment: { providerPaymentId: string | null } };
type MutableRefund = TestRefund & Record<string, unknown>;

function txFor(row: MutableRefund): Prisma.TransactionClient {
  const client = { $queryRaw: async () => [], refund: { findUnique: async () => row, findUniqueOrThrow: async () => row, update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(row, data) } };
  return client as unknown as Prisma.TransactionClient;
}
function row(id: string, status: Refund["status"]): MutableRefund {
  return { id, status, executionKey: null, providerRefundId: null, providerOutcome: null, providerObservedAt: null, amount: new Prisma.Decimal("42.50"), currency: "TRY", payment: { providerPaymentId: "payment-ref" } };
}

async function main() {
  const refund = row("refund-1", "APPROVED");
  const claimed = await claimRefundExecution(txFor(refund), refund.id);
  assert(!claimed.idempotent && refund.status === "PROCESSING" && refund.executionKey === "refund:refund-1");
  const unknown = await finalizeRefundExecution(txFor(refund), { refundId: refund.id, result: { outcome: "UNKNOWN" } });
  assert(unknown.requiresReview && refund.status === "PROCESSING", "unknown provider outcome must not become terminal");
  const completed = await finalizeRefundExecution(txFor(refund), { refundId: refund.id, result: { outcome: "COMPLETED", providerRefundId: "provider-refund-1" } });
  assert(completed.status === "COMPLETED" && refund.providerRefundId === "provider-refund-1");
  assert((await finalizeRefundExecution(txFor(refund), { refundId: refund.id, result: { outcome: "COMPLETED", providerRefundId: "provider-refund-1" } })).idempotent);
  const failed = row("refund-2", "PROCESSING");
  assert((await finalizeRefundExecution(txFor(failed), { refundId: failed.id, result: { outcome: "FAILED" } })).status === "FAILED");
  const timedOut = row("refund-3", "APPROVED");
  const timeoutProvider: PaymentRefundProvider = { refund: async () => { throw new Error("timeout"); } };
  const transaction = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => operation(txFor(timedOut));
  const timeout = await executeClaimedRefund({ refundId: timedOut.id, provider: timeoutProvider, transaction });
  assert(timeout.status === "PROCESSING" && timeout.requiresReview && timedOut.providerOutcome === "UNKNOWN", "provider timeout must not be retried or finalized as a refund");
  console.log("PASS: refund claim/call/finalize keeps unknown outcomes non-terminal and terminal finalization idempotent");
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
