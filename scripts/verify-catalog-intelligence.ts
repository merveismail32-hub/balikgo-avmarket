import { strict as assert } from "node:assert";
import { decideCatalogMatch, normalizeCatalogText, parseGtin, type CatalogCandidate } from "../app/lib/catalog-intelligence.ts";

const valid = ["96385074", "036000291452", "4006381333931", "10012345678902"];
for (const code of valid) assert.equal(parseGtin(code).valid, true, `${code} should be valid`);
assert.equal(parseGtin("4006381333932").valid, false);
assert.equal(parseGtin("40063813X3931").valid, false);
assert.equal(parseGtin("123").valid, false);
assert.equal(parseGtin(" 0360-0029 1452 ").valid && parseGtin(" 0360-0029 1452 ").normalized, "036000291452");
assert.equal(normalizeCatalogText("  SHİMANO—  Vanford  "), "shimano vanford");

const gtin = parseGtin("4006381333931");
const candidate = (id: string, overrides: Partial<CatalogCandidate> = {}): CatalogCandidate => ({ id, normalizedGtin: null, normalizedName: "olta", normalizedBrand: "shimano", normalizedModel: "x1", ...overrides });
assert.equal(decideCatalogMatch({ gtin, sellerSku: null, normalizedName: "olta", normalizedBrand: "shimano", normalizedModel: "x1", candidates: [candidate("cat1", { normalizedGtin: "4006381333931" })] }).type, "EXACT_GTIN_MATCH");
assert.equal(decideCatalogMatch({ gtin, sellerSku: "A", normalizedName: "olta", normalizedBrand: "shimano", normalizedModel: "x1", candidates: [], sellerSkuOffer: { id: "o1", catalogProductId: "cat1", sellerSku: "A" } }).type, "SELLER_SKU_MATCH");
assert.equal(decideCatalogMatch({ gtin, sellerSku: "A", normalizedName: "olta", normalizedBrand: "shimano", normalizedModel: "x1", candidates: [candidate("cat2", { normalizedGtin: "4006381333931" })], sellerSkuOffer: { id: "o1", catalogProductId: "cat1", sellerSku: "A" } }).reason, "SKU_GTIN_CONFLICT");
assert.equal(decideCatalogMatch({ gtin, sellerSku: null, normalizedName: "olta", normalizedBrand: "daiwa", normalizedModel: "x1", candidates: [candidate("cat1", { normalizedGtin: "4006381333931" })] }).reason, "GTIN_BRAND_CONFLICT");
assert.equal(decideCatalogMatch({ gtin, sellerSku: null, normalizedName: "olta", normalizedBrand: "shimano", normalizedModel: "x2", candidates: [candidate("cat1", { normalizedGtin: "4006381333931" })] }).reason, "GTIN_MODEL_CONFLICT");
const empty = parseGtin(null);
assert.equal(decideCatalogMatch({ gtin: empty, sellerSku: null, normalizedName: "new", normalizedBrand: "x", normalizedModel: null, candidates: [] }).type, "NEW_CATALOG_PRODUCT");
assert.equal(decideCatalogMatch({ gtin: empty, sellerSku: null, normalizedName: "olta", normalizedBrand: "shimano", normalizedModel: "x1", candidates: [candidate("cat1")] }).type, "REVIEW_REQUIRED");
const multiple = decideCatalogMatch({ gtin: empty, sellerSku: null, normalizedName: "olta", normalizedBrand: "shimano", normalizedModel: "x1", candidates: [candidate("z"), candidate("a")] });
assert.deepEqual(multiple.candidateIds, ["a", "z"]);
assert.equal(decideCatalogMatch({ gtin: parseGtin("123"), sellerSku: null, normalizedName: "x", normalizedBrand: null, normalizedModel: null, candidates: [] }).reason, "INVALID_GTIN");
console.log("PASS: catalog normalization and deterministic matching (18 assertions).");
