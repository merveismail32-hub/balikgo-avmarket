import assert from "node:assert/strict";
import { calculateInternalPriceBenchmark, PriceBenchmarkError } from "../app/lib/pricing-benchmark";

const target = { sellerOfferId: "target", catalogProductId: "catalog", sellerId: "seller-target", price: "120.004" };
const comparable = (id: string, price: string, sellerId = `seller-${id}`) => ({ sellerOfferId: id, catalogProductId: "catalog", sellerId, price });
const codeIs = (code: string) => (error: unknown) => error instanceof PriceBenchmarkError && error.code === code;

const none = calculateInternalPriceBenchmark({ target, comparables: [] });
assert.deepEqual({ state: none.evidenceState, count: none.comparableCount, median: none.medianPrice }, { state: "NO_COMPARABLES", count: 0, median: null });
const one = calculateInternalPriceBenchmark({ target, comparables: [comparable("a", "100")] });
assert.equal(one.evidenceState, "INSUFFICIENT_COMPARABLES"); assert.equal(one.relativePosition, "ABOVE_MEDIAN"); assert.equal(one.targetPrice, "120.00");
const odd = calculateInternalPriceBenchmark({ target, comparables: [comparable("a", "100"), comparable("b", "110"), comparable("c", "130")] });
assert.equal(odd.medianPrice, "110.00"); assert.equal(odd.minimumPrice, "100.00"); assert.equal(odd.maximumPrice, "130.00"); assert.equal(odd.absoluteDifference, "10.00"); assert.equal(odd.percentageDifference, "9.0909");
const even = calculateInternalPriceBenchmark({ target: { ...target, price: "80" }, comparables: [comparable("d", "130"), comparable("b", "110"), comparable("a", "100"), comparable("c", "120")] });
assert.equal(even.medianPrice, "115.00"); assert.equal(even.relativePosition, "BELOW_MEDIAN"); assert.equal(even.absoluteDifference, "-35.00");
const outlier = calculateInternalPriceBenchmark({ target, comparables: [comparable("a", "98"), comparable("b", "100"), comparable("c", "101"), comparable("x", "50000")] });
assert.equal(outlier.medianPrice, "100.50"); assert.equal(outlier.maximumPrice, "50000.00");
const shuffled = calculateInternalPriceBenchmark({ target, comparables: [comparable("c", "130"), comparable("a", "100"), comparable("b", "110")] });
assert.deepEqual(shuffled, odd);
assert.throws(() => calculateInternalPriceBenchmark({ target, comparables: [target] }), codeIs("TARGET_INCLUDED"));
assert.throws(() => calculateInternalPriceBenchmark({ target, comparables: [comparable("a", "100"), comparable("a", "110", "other")] }), codeIs("DUPLICATE_OFFER"));
assert.throws(() => calculateInternalPriceBenchmark({ target, comparables: [comparable("a", "100"), comparable("b", "110", "seller-a")] }), codeIs("DUPLICATE_SELLER"));
assert.throws(() => calculateInternalPriceBenchmark({ target, comparables: [{ ...comparable("a", "100"), catalogProductId: "wrong" }] }), codeIs("CATALOG_MISMATCH"));
assert.throws(() => calculateInternalPriceBenchmark({ target, comparables: [comparable("a", "0")] }), codeIs("INVALID_PRICE"));
console.log("PASS: #25 Slice C Decimal-safe exact-product median, evidence quality, self/duplicate guards, deterministic ordering and outlier robustness");
