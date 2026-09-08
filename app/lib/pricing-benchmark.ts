import { Prisma } from "@prisma/client";

export type PriceBenchmarkEvidenceState = "NO_COMPARABLES" | "INSUFFICIENT_COMPARABLES" | "BENCHMARK_AVAILABLE";
export type PriceRelativePosition = "BELOW_MEDIAN" | "AT_MEDIAN" | "ABOVE_MEDIAN";

export type InternalPriceComparable = Readonly<{
  sellerOfferId: string;
  catalogProductId: string;
  sellerId: string;
  price: Prisma.Decimal.Value;
}>;

export type InternalPriceBenchmark = Readonly<{
  catalogProductId: string;
  comparableCount: number;
  evidenceState: PriceBenchmarkEvidenceState;
  currency: "TRY";
  targetPrice: string;
  minimumPrice: string | null;
  maximumPrice: string | null;
  medianPrice: string | null;
  absoluteDifference: string | null;
  percentageDifference: string | null;
  relativePosition: PriceRelativePosition | null;
}>;

export class PriceBenchmarkError extends Error {
  constructor(readonly code: "INVALID_PRICE" | "CATALOG_MISMATCH" | "TARGET_INCLUDED" | "DUPLICATE_OFFER" | "DUPLICATE_SELLER") { super(code); }
}

function money(value: Prisma.Decimal.Value) {
  let amount: Prisma.Decimal;
  try { amount = new Prisma.Decimal(value).toDecimalPlaces(2); } catch { throw new PriceBenchmarkError("INVALID_PRICE"); }
  if (amount.lessThanOrEqualTo(0) || amount.greaterThan("9999999999.99")) throw new PriceBenchmarkError("INVALID_PRICE");
  return amount;
}

function formatted(value: Prisma.Decimal) { return value.toFixed(2); }

export function calculateInternalPriceBenchmark(input: Readonly<{
  target: InternalPriceComparable;
  comparables: readonly InternalPriceComparable[];
}>): InternalPriceBenchmark {
  const targetPrice = money(input.target.price);
  const offerIds = new Set<string>(); const sellerIds = new Set<string>();
  const prices = input.comparables.map((comparable) => {
    if (comparable.sellerOfferId === input.target.sellerOfferId) throw new PriceBenchmarkError("TARGET_INCLUDED");
    if (comparable.catalogProductId !== input.target.catalogProductId) throw new PriceBenchmarkError("CATALOG_MISMATCH");
    if (offerIds.has(comparable.sellerOfferId)) throw new PriceBenchmarkError("DUPLICATE_OFFER");
    if (sellerIds.has(comparable.sellerId) || comparable.sellerId === input.target.sellerId) throw new PriceBenchmarkError("DUPLICATE_SELLER");
    offerIds.add(comparable.sellerOfferId); sellerIds.add(comparable.sellerId);
    return money(comparable.price);
  }).sort((left, right) => left.comparedTo(right));

  if (!prices.length) return Object.freeze({ catalogProductId: input.target.catalogProductId, comparableCount: 0, evidenceState: "NO_COMPARABLES", currency: "TRY", targetPrice: formatted(targetPrice), minimumPrice: null, maximumPrice: null, medianPrice: null, absoluteDifference: null, percentageDifference: null, relativePosition: null });
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle] : prices[middle - 1].plus(prices[middle]).div(2).toDecimalPlaces(2);
  const difference = targetPrice.minus(median).toDecimalPlaces(2);
  const percentage = difference.div(median).mul(100).toDecimalPlaces(4);
  return Object.freeze({
    catalogProductId: input.target.catalogProductId,
    comparableCount: prices.length,
    evidenceState: prices.length === 1 ? "INSUFFICIENT_COMPARABLES" : "BENCHMARK_AVAILABLE",
    currency: "TRY",
    targetPrice: formatted(targetPrice),
    minimumPrice: formatted(prices[0]),
    maximumPrice: formatted(prices.at(-1)!),
    medianPrice: formatted(median),
    absoluteDifference: formatted(difference),
    percentageDifference: percentage.toFixed(4),
    relativePosition: difference.isNegative() ? "BELOW_MEDIAN" : difference.isPositive() ? "ABOVE_MEDIAN" : "AT_MEDIAN",
  });
}
