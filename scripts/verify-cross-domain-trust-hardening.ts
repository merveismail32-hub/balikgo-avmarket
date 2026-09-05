import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalogReviewFingerprint, closeCatalogMatchReviewData, type CatalogReviewIdentityInput } from "../app/lib/catalog-match-review.ts";
import { decideCatalogMatch, parseGtin } from "../app/lib/catalog-intelligence.ts";
import { defineProviderTrustAdapter, evaluateProviderBoundary } from "../app/lib/provider-trust-boundary.ts";
import { carrierEventDecision } from "../app/lib/shipping.ts";

const root = resolve(import.meta.dirname, "..");
const source = (file: string) => readFileSync(resolve(root, file), "utf8");
const payment = source("app/lib/payment-orchestrator.ts");
const paymentTypes = source("app/lib/payments/types.ts");
const shipment = source("app/lib/shipment-event-ingestion.ts");
const catalog = source("app/lib/catalog-match-review.ts");
const stock = source("app/lib/stock-truth.ts");
const order = source("app/lib/order-orchestrator.ts");
const ledger = order + source("app/lib/stock-reservation.ts");
const refund = source("app/lib/refund-orchestrator.ts");

type Message = { authentic: boolean; status: "POSITIVE" | "NEGATIVE" | "UNKNOWN" };
const adapter = defineProviderTrustAdapter<Message>({ authenticate: (message) => message.authentic, normalizeResult: (message) => message.status });
const identity = { provider: "SYNTHETIC_PAYMENT", accountReference: "merchant-test", environment: "SANDBOX" };
const binding = { parts: ["payment-a", "order-a", "PAYMENT_CALLBACK", identity.provider, identity.accountReference, identity.environment] } as const;
const evidence = { externalEventId: "event-a", reference: "hash:synthetic-a", verificationMethod: "SIGNED_WEBHOOK", receivedAt: new Date("2026-09-02T12:00:00Z") };
const unauthenticated = evaluateProviderBoundary({ adapter, message: { authentic: false, status: "POSITIVE" }, expectedIdentity: identity, observedIdentity: identity, expectedBinding: binding, observedBinding: binding, intent: "PAYMENT_CALLBACK", evidence });
assert.equal(unauthenticated.readyForDomainEvaluation, false);
assert.equal("applicable" in unauthenticated, false);

assert.match(paymentTypes, /verifyAndParseWebhook\(request: Request, rawBody: string\): Promise<VerifiedPaymentEvent>/);
assert.match(payment, /Only verified events enter here/);
assert.match(payment, /provider_providerEventId/);
assert.match(payment, /PAYMENT_EVENT_CONFLICT/);
assert.match(payment, /PAYMENT_PAID.*PAYMENT_FAILED/);
assert.doesNotMatch(payment + paymentTypes, /FinancialVerificationAssurance|evaluatePayoutTrust/);

assert.match(shipment, /shipmentId_source_externalEventId/);
assert.match(shipment, /carrierEventDecision/);
assert.match(shipment, /applied: decision\.apply \|\| decision\.equivalent/);
assert.deepEqual(carrierEventDecision("OUT_FOR_DELIVERY", "IN_TRANSIT", new Date("2026-09-02T11:00:00Z"), new Date("2026-09-02T12:00:00Z")), { apply: false, stale: true, equivalent: false });
assert.doesNotMatch(shipment, /FinancialVerificationAssurance|evaluatePayoutTrust/);

const match = decideCatalogMatch({ gtin: parseGtin(null), sellerSku: null, normalizedName: "rod", normalizedBrand: "synthetic", normalizedModel: "x", candidates: [{ id: "catalog-a", normalizedGtin: null, normalizedName: "rod", normalizedBrand: "synthetic", normalizedModel: "x" }] });
assert.equal(match.type, "REVIEW_REQUIRED");
assert.equal(match.confidence, 0.6);
assert.equal("assurance" in match, false);
const review: CatalogReviewIdentityInput = { sellerId: "seller-a", sellerOfferId: "offer-a", matchStatus: "REVIEW_REQUIRED", reasonCode: "TEXT_CANDIDATE", normalizedName: "rod", normalizedBrand: "synthetic", normalizedModel: "x" };
assert.notEqual(catalogReviewFingerprint(review).fingerprint, catalogReviewFingerprint({ ...review, sellerId: "seller-b" }).fingerprint);
assert.throws(() => closeCatalogMatchReviewData({ status: "RESOLVED", fingerprint: catalogReviewFingerprint(review).fingerprint }, "REJECTED"), /CATALOG_REVIEW_ALREADY_CLOSED/);
assert.doesNotMatch(catalog, /FinancialVerificationAssurance/);

assert.match(stock, /inventoryVersion/);
assert.match(stock, /STALE_INVENTORY_VERSION/);
assert.match(stock, /pg_advisory_xact_lock/);
assert.match(stock, /StockMovement/);
assert.doesNotMatch(stock, /ProviderBoundaryDecision|FinancialVerificationAssurance/);

assert.match(order, /evaluateCancellationEligibility/);
assert.match(order, /orderItem\.updateMany\(\{ where: \{ id: item\.id, status: item\.status, \.\.\.ownership \}/);
assert.match(ledger, /financialLedgerEntry/);
assert.doesNotMatch(ledger, /trust-primitives|provider-trust-boundary/);
assert.match(refund, /outcome: "COMPLETED" \| "FAILED" \| "UNKNOWN"/);
assert.match(refund, /UNKNOWN[\s\S]*requiresReview: true/);
for (const domainSource of [order, ledger, refund]) assert.doesNotMatch(domainSource, /FinancialVerificationAssurance|ProviderBoundaryDecision/);

assert.match(payment, /payloadHash: input\.payloadHash/);
assert.match(shipment, /payloadHash: input\.payloadHash\?\.toLowerCase\(\)/);
assert.doesNotMatch(payment + shipment, /payloadHash[\s\S]{0,120}(authenticate|signature|trusted)/i, "payload hashes are audit references, not authenticity proofs");

console.log("PASS: #21 Slice D payment, shipment, catalog, stock, order, ledger and refund authorities remain domain-owned and fail closed");
