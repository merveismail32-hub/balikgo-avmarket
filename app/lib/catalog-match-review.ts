import "server-only";

import { createHash } from "node:crypto";
import type { CatalogMatchReviewStatus, CatalogMatchStatus, PrismaClient } from "@prisma/client";
import { normalizeSku } from "../../lib/sku.ts";
import { normalizeCatalogText, parseGtin } from "./catalog-intelligence.ts";

const FINGERPRINT_VERSION = "catalog-review:v1";
const TEXT_IDENTITY_REASONS = new Set(["TEXT_CANDIDATE", "MULTIPLE_TEXT_CANDIDATES", "INVALID_GTIN"]);

export type CatalogReviewIdentityInput = {
  sellerId: string;
  sellerOfferId?: string | null;
  sellerSku?: string | null;
  proposedGtin?: string | null;
  candidateIds?: string[];
  matchStatus: CatalogMatchStatus;
  reasonCode: string;
  normalizedName?: string | null;
  normalizedBrand?: string | null;
  normalizedModel?: string | null;
  source?: string | null;
  externalSourceId?: string | null;
};

export type CatalogReviewCreateInput = CatalogReviewIdentityInput & { confidence?: number | null };

function normalizedOptional(value: string | null | undefined) {
  const normalized = value?.normalize("NFKC").trim();
  return normalized || null;
}

function normalizedCandidateIds(candidateIds: string[] | undefined) {
  return [...new Set((candidateIds ?? []).map(normalizedOptional).filter((value): value is string => Boolean(value)))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function normalizedProposedGtin(value: string | null | undefined) {
  const parsed = parseGtin(value);
  return parsed.valid ? parsed.normalized : null;
}

export function catalogReviewFingerprint(input: CatalogReviewIdentityInput) {
  const candidateIds = normalizedCandidateIds(input.candidateIds);
  const includeTextIdentity = TEXT_IDENTITY_REASONS.has(input.reasonCode);
  const sellerOfferId = normalizedOptional(input.sellerOfferId);
  const canonical = [
    ["version", FINGERPRINT_VERSION],
    ["sellerId", normalizedOptional(input.sellerId)],
    ["matchStatus", input.matchStatus],
    ["reasonCode", normalizedOptional(input.reasonCode)],
    ["proposedGtin", normalizedProposedGtin(input.proposedGtin)],
    ["sellerOfferId", sellerOfferId],
    ["sellerSku", sellerOfferId ? null : normalizeSku(input.sellerSku)],
    ["source", normalizedOptional(input.source)],
    ["externalSourceId", normalizedOptional(input.externalSourceId)],
    ["candidateIds", candidateIds],
    ["normalizedName", includeTextIdentity ? normalizeCatalogText(input.normalizedName) : null],
    ["normalizedBrand", includeTextIdentity ? normalizeCatalogText(input.normalizedBrand) : null],
    ["normalizedModel", includeTextIdentity ? normalizeCatalogText(input.normalizedModel) : null],
  ];
  return { fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), candidateIds };
}

const reviewSelect = { id: true, sellerId: true, sellerOfferId: true, fingerprint: true, openFingerprint: true, status: true } as const;

function assertReviewOwner(review: { sellerId: string }, sellerId: string) {
  if (review.sellerId !== sellerId) throw new Error("CATALOG_REVIEW_OWNER_MISMATCH");
}

function isOpenFingerprintConflict(error: unknown) {
  if (typeof error !== "object" || error === null || (error as { code?: string }).code !== "P2002") return false;
  return JSON.stringify((error as { meta?: unknown }).meta ?? "").includes("openFingerprint");
}

export async function createOrGetOpenCatalogMatchReview(client: Pick<PrismaClient, "catalogMatchReview">, input: CatalogReviewCreateInput) {
  const { fingerprint, candidateIds } = catalogReviewFingerprint(input);
  const existing = await client.catalogMatchReview.findUnique({ where: { openFingerprint: fingerprint }, select: reviewSelect });
  if (existing) {
    assertReviewOwner(existing, input.sellerId);
    return { review: existing, created: false, fingerprint };
  }
  try {
    const review = await client.catalogMatchReview.create({
      data: {
        sellerId: input.sellerId,
        sellerOfferId: input.sellerOfferId ?? null,
        candidateCatalogProductId: candidateIds[0] ?? null,
        sellerSku: normalizeSku(input.sellerSku),
        proposedGtin: normalizedProposedGtin(input.proposedGtin),
        normalizedName: normalizeCatalogText(input.normalizedName),
        normalizedBrand: normalizeCatalogText(input.normalizedBrand),
        normalizedModel: normalizeCatalogText(input.normalizedModel),
        matchStatus: input.matchStatus,
        reasonCode: input.reasonCode,
        confidence: input.confidence ?? null,
        source: normalizedOptional(input.source),
        externalSourceId: normalizedOptional(input.externalSourceId),
        fingerprint,
        openFingerprint: fingerprint,
        status: "PENDING",
      },
      select: reviewSelect,
    });
    return { review, created: true, fingerprint };
  } catch (error) {
    if (!isOpenFingerprintConflict(error)) throw error;
    const review = await client.catalogMatchReview.findUnique({ where: { openFingerprint: fingerprint }, select: reviewSelect });
    if (!review) throw error;
    assertReviewOwner(review, input.sellerId);
    return { review, created: false, fingerprint };
  }
}

export function closeCatalogMatchReviewData(review: { status: CatalogMatchReviewStatus; fingerprint: string | null }, target: "RESOLVED" | "REJECTED") {
  if (review.status !== "PENDING") throw new Error("CATALOG_REVIEW_ALREADY_CLOSED");
  return { status: target, openFingerprint: null, fingerprint: review.fingerprint } as const;
}
