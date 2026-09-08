import assert from "node:assert/strict";
import { evaluatePricingAnomaly, PRICING_ANOMALY_ALGORITHM_VERSION, type PricingAnomalyConfig } from "../app/lib/pricing-anomaly";
import { calculateInternalPriceBenchmark } from "../app/lib/pricing-benchmark";

const at = new Date("2026-09-07T12:00:00.000Z");
const config: PricingAnomalyConfig = { suspiciousPeerDeviationPct: "25", criticalPeerDeviationPct: "60", suspiciousHistoricalChangePct: "25", criticalHistoricalChangePct: "60" };
const offer = (id: string, price: string) => ({ sellerOfferId: id, sellerId: `seller-${id}`, catalogProductId: "catalog", price });
const benchmark = (targetPrice: string, prices: string[]) => calculateInternalPriceBenchmark({ target: offer("target", targetPrice), comparables: prices.map((price, index) => offer(String(index), price)) });
const evaluate = (targetPrice: string, prices: string[], previousPrice: string | null = null) => evaluatePricingAnomaly({ benchmark: benchmark(targetPrice, prices), history: { previousPrice, observationCount: previousPrice ? 2 : 1, lastObservedAt: previousPrice ? at : null }, evaluatedAt: at, config });

assert.equal(evaluate("100", []).status, "INSUFFICIENT_EVIDENCE");
const weak = evaluate("10", ["100"]); assert.equal(weak.status, "INSUFFICIENT_EVIDENCE"); assert.equal(weak.confidence, "LOW"); assert.deepEqual(weak.reasons, ["LOW_COMPARABLE_COUNT"]);
const normal = evaluate("100", ["90", "100", "110"]); assert.equal(normal.status, "NORMAL"); assert.equal(normal.confidence, "MEDIUM");
const moderate = evaluate("130", ["90", "100", "110"]); assert.equal(moderate.status, "SUSPICIOUS"); assert.deepEqual(moderate.reasons, ["PEER_PRICE_HIGH"]);
const low = evaluate("20", ["90", "100", "110"]); assert.equal(low.status, "CRITICAL"); assert.deepEqual(low.reasons, ["PEER_PRICE_EXTREME_LOW"]); assert.equal(low.confidence, "MEDIUM");
const high = evaluate("200", ["90", "100", "110"]); assert.equal(high.status, "CRITICAL"); assert.deepEqual(high.reasons, ["PEER_PRICE_EXTREME_HIGH"]);
const combined = evaluate("20", ["90", "100", "110"], "100"); assert.equal(combined.confidence, "HIGH"); assert.deepEqual(combined.reasons, ["PEER_PRICE_EXTREME_LOW", "SUDDEN_PRICE_DROP"]);
const historyOnly = evaluate("20", [], "100"); assert.equal(historyOnly.status, "SUSPICIOUS"); assert.equal(historyOnly.confidence, "LOW"); assert.deepEqual(historyOnly.reasons, ["NO_COMPARABLES", "SUDDEN_PRICE_DROP"]);
const increase = evaluate("200", [], "100"); assert.deepEqual(increase.reasons, ["NO_COMPARABLES", "SUDDEN_PRICE_INCREASE"]);
const unchanged = evaluate("100", ["90", "100", "110"], "100"); assert.equal(unchanged.status, "NORMAL"); assert.equal(unchanged.history.percentageChange, "0.0000");
const robust = evaluate("100", ["98", "99", "101", "50000"]); assert.equal(robust.status, "NORMAL"); assert.equal(robust.benchmark.medianPrice, "100.00");
const orderedA = evaluate("20", ["90", "100", "110"], "100"); const orderedB = evaluate("20", ["110", "90", "100"], "100"); assert.deepEqual(orderedA, orderedB);
assert.equal(orderedA.algorithmVersion, PRICING_ANOMALY_ALGORITHM_VERSION); assert.equal(orderedA.evaluatedAt, at.toISOString());
console.log("PASS: #25 Slice D versioned deterministic peer/history anomaly signals, confidence, weak-evidence safety and explainability");
