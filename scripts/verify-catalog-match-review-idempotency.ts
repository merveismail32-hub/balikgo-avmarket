import { strict as assert } from "node:assert";
import { catalogReviewFingerprint, closeCatalogMatchReviewData, type CatalogReviewIdentityInput } from "../app/lib/catalog-match-review.ts";

const base: CatalogReviewIdentityInput = {
  sellerId: "seller-a",
  sellerOfferId: "offer-a",
  sellerSku: "ignored-when-offer-exists",
  proposedGtin: "4006381333931",
  candidateIds: ["catalog-b", "catalog-a"],
  matchStatus: "CONFLICT",
  reasonCode: "SKU_GTIN_CONFLICT",
  normalizedName: "Olta",
  normalizedBrand: "Shimano",
  normalizedModel: "X1",
};
const hash = (input: CatalogReviewIdentityInput) => catalogReviewFingerprint(input).fingerprint;
const same = (overrides: Partial<CatalogReviewIdentityInput> = {}) => hash({ ...base, ...overrides });

assert.equal(hash(base), hash(base));
assert.equal(hash({ reasonCode: base.reasonCode, matchStatus: base.matchStatus, candidateIds: base.candidateIds, proposedGtin: base.proposedGtin, sellerOfferId: base.sellerOfferId, sellerId: base.sellerId }), hash(base));
assert.equal(same({ candidateIds: ["catalog-a", "catalog-b"] }), hash(base));
assert.equal(same({ candidateIds: ["catalog-b", "catalog-a", "catalog-a"] }), hash(base));
assert.notEqual(same({ candidateIds: ["catalog-a", "catalog-c"] }), hash(base));
assert.notEqual(same({ sellerId: "seller-b" }), hash(base));
assert.notEqual(same({ sellerOfferId: "offer-b" }), hash(base));
assert.notEqual(same({ proposedGtin: "036000291452" }), hash(base));
assert.notEqual(same({ reasonCode: "GTIN_BRAND_CONFLICT" }), hash(base));
assert.notEqual(same({ matchStatus: "REVIEW_REQUIRED" }), hash(base));
assert.equal(hash({ ...base, price: 1, stock: 99, active: false, timestamp: "2099-01-01", requestId: "random" } as CatalogReviewIdentityInput), hash(base));
assert.equal(hash({ ...base, email: "person@example.invalid", phone: "555", address: "private", payload: { arbitrary: true } } as CatalogReviewIdentityInput), hash(base));
assert.equal(same({ sellerOfferId: null, sellerSku: "  sku-a  ", proposedGtin: " 4006-3813 33931 " }), same({ sellerOfferId: null, sellerSku: "SKU-A", proposedGtin: "4006381333931" }));
assert.equal(same({ sellerOfferId: null, sellerSku: "   ", proposedGtin: null }), same({ sellerOfferId: null, sellerSku: null, proposedGtin: "" }));
assert.equal(same({ reasonCode: "MULTIPLE_TEXT_CANDIDATES", matchStatus: "REVIEW_REQUIRED", candidateIds: ["b", "a"] }), same({ reasonCode: "MULTIPLE_TEXT_CANDIDATES", matchStatus: "REVIEW_REQUIRED", candidateIds: ["a", "b"] }));

for (const target of ["RESOLVED", "REJECTED"] as const) {
  const closed = closeCatalogMatchReviewData({ status: "PENDING", fingerprint: hash(base) }, target);
  assert.equal(closed.status, target);
  assert.equal(closed.openFingerprint, null);
  assert.equal(closed.fingerprint, hash(base));
}
assert.throws(() => closeCatalogMatchReviewData({ status: "RESOLVED", fingerprint: hash(base) }, "REJECTED"), /CATALOG_REVIEW_ALREADY_CLOSED/);

console.log("PASS: catalog review canonical SHA-256 identity and lifecycle invariants verified.");
