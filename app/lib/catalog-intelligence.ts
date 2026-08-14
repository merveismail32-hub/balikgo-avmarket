import "server-only";

export const GTIN_LENGTHS = [8, 12, 13, 14] as const;
export type CatalogMatchType = "EXACT_GTIN_MATCH" | "SELLER_SKU_MATCH" | "NEW_CATALOG_PRODUCT" | "REVIEW_REQUIRED" | "CONFLICT";
export type CatalogMatchReason = "GTIN_EXACT" | "SELLER_SKU_EXACT" | "NO_CANDIDATE" | "TEXT_CANDIDATE" | "MULTIPLE_TEXT_CANDIDATES" | "INVALID_GTIN" | "SKU_GTIN_CONFLICT" | "SKU_GTIN_IDENTITY_UNVERIFIED" | "GTIN_BRAND_CONFLICT" | "GTIN_MODEL_CONFLICT";

export type GtinResult =
  | { valid: true; original: string; normalized: string; format: "EAN_8" | "UPC_A" | "EAN_13" | "GTIN_14" }
  | { valid: false; original: string; normalized: string | null; reason: "EMPTY" | "INVALID_CHARACTERS" | "INVALID_LENGTH" | "INVALID_CHECK_DIGIT" };

export function normalizeCatalogText(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function parseGtin(value: string | null | undefined): GtinResult {
  const original = value?.normalize("NFKC").trim() ?? "";
  if (!original) return { valid: false, original, normalized: null, reason: "EMPTY" };
  const normalized = original.replace(/[\s._-]+/g, "");
  if (!/^\d+$/.test(normalized)) return { valid: false, original, normalized: null, reason: "INVALID_CHARACTERS" };
  if (!(GTIN_LENGTHS as readonly number[]).includes(normalized.length)) return { valid: false, original, normalized, reason: "INVALID_LENGTH" };
  const digits = [...normalized].map(Number);
  const supplied = digits.pop()!;
  const sum = digits.reduceRight((total, digit, indexFromLeft, all) => {
    const indexFromRight = all.length - 1 - indexFromLeft;
    return total + digit * (indexFromRight % 2 === 0 ? 3 : 1);
  }, 0);
  if ((10 - (sum % 10)) % 10 !== supplied) return { valid: false, original, normalized, reason: "INVALID_CHECK_DIGIT" };
  const format = normalized.length === 8 ? "EAN_8" : normalized.length === 12 ? "UPC_A" : normalized.length === 13 ? "EAN_13" : "GTIN_14";
  return { valid: true, original, normalized, format };
}

export type CatalogCandidate = { id: string; normalizedGtin: string | null; normalizedName: string | null; normalizedBrand: string | null; normalizedModel: string | null };
export type SellerSkuOffer = { id: string; catalogProductId: string; sellerSku: string | null; catalogProduct: { normalizedGtin: string | null; barcode: string | null } };
export type CatalogMatchInput = { gtin: GtinResult; sellerSku: string | null; normalizedName: string | null; normalizedBrand: string | null; normalizedModel: string | null; candidates: CatalogCandidate[]; sellerSkuOffer?: SellerSkuOffer | null };
export type CatalogMatchDecision = { type: CatalogMatchType; reason: CatalogMatchReason; catalogProductId: string | null; sellerOfferId: string | null; candidateIds: string[]; confidence: number };

export function decideCatalogMatch(input: CatalogMatchInput): CatalogMatchDecision {
  const candidates = [...input.candidates].sort((a, b) => a.id.localeCompare(b.id));
  const exact = input.gtin.valid ? candidates.find((item) => item.normalizedGtin === input.gtin.normalized) : undefined;
  if (input.sellerSkuOffer) {
    if (!input.gtin.valid && input.gtin.reason !== "EMPTY") return decision("REVIEW_REQUIRED", "INVALID_GTIN", null, input.sellerSkuOffer.id, [input.sellerSkuOffer.catalogProductId], 0);
    if (input.gtin.valid) {
      const linkedNormalizedGtin = input.sellerSkuOffer.catalogProduct.normalizedGtin;
      const legacyGtin = linkedNormalizedGtin ? null : parseGtin(input.sellerSkuOffer.catalogProduct.barcode);
      const linkedGtin = linkedNormalizedGtin ?? (legacyGtin?.valid ? legacyGtin.normalized : null);
      if (!linkedGtin) return decision("REVIEW_REQUIRED", "SKU_GTIN_IDENTITY_UNVERIFIED", null, input.sellerSkuOffer.id, [input.sellerSkuOffer.catalogProductId], 0);
      if (linkedGtin !== input.gtin.normalized) return decision("CONFLICT", "SKU_GTIN_CONFLICT", null, input.sellerSkuOffer.id, [exact?.id ?? input.sellerSkuOffer.catalogProductId], 1);
    }
    if (exact && exact.id !== input.sellerSkuOffer.catalogProductId) return decision("CONFLICT", "SKU_GTIN_CONFLICT", null, input.sellerSkuOffer.id, [exact.id], 1);
    return decision("SELLER_SKU_MATCH", "SELLER_SKU_EXACT", input.sellerSkuOffer.catalogProductId, input.sellerSkuOffer.id, [], 1);
  }
  if (exact) {
    if (input.normalizedBrand && exact.normalizedBrand && input.normalizedBrand !== exact.normalizedBrand) return decision("CONFLICT", "GTIN_BRAND_CONFLICT", exact.id, null, [exact.id], 1);
    if (input.normalizedModel && exact.normalizedModel && input.normalizedModel !== exact.normalizedModel) return decision("CONFLICT", "GTIN_MODEL_CONFLICT", exact.id, null, [exact.id], 1);
    return decision("EXACT_GTIN_MATCH", "GTIN_EXACT", exact.id, null, [exact.id], 1);
  }
  if (!input.gtin.valid && input.gtin.reason !== "EMPTY") return decision("REVIEW_REQUIRED", "INVALID_GTIN", null, null, candidates.map((item) => item.id), 0);
  const textCandidates = candidates.filter((item) => item.normalizedName === input.normalizedName && item.normalizedBrand === input.normalizedBrand && item.normalizedModel === input.normalizedModel);
  if (textCandidates.length === 0) return decision("NEW_CATALOG_PRODUCT", "NO_CANDIDATE", null, null, [], 1);
  return decision("REVIEW_REQUIRED", textCandidates.length > 1 ? "MULTIPLE_TEXT_CANDIDATES" : "TEXT_CANDIDATE", null, null, textCandidates.map((item) => item.id), textCandidates.length === 1 ? 0.6 : 0.4);
}

function decision(type: CatalogMatchType, reason: CatalogMatchReason, catalogProductId: string | null, sellerOfferId: string | null, candidateIds: string[], confidence: number): CatalogMatchDecision {
  return { type, reason, catalogProductId, sellerOfferId, candidateIds, confidence };
}
