import { Prisma } from "@prisma/client";
import type { InternalPriceBenchmark } from "./pricing-benchmark";

export const PRICING_ANOMALY_ALGORITHM_VERSION = "PRICING_ANOMALY_V1" as const;

export type PricingAnomalyStatus = "INSUFFICIENT_EVIDENCE" | "NORMAL" | "SUSPICIOUS" | "CRITICAL";
export type PricingAnomalyConfidence = "LOW" | "MEDIUM" | "HIGH";
export type PricingAnomalyReason = "NO_COMPARABLES" | "LOW_COMPARABLE_COUNT" | "PEER_PRICE_LOW" | "PEER_PRICE_HIGH" | "PEER_PRICE_EXTREME_LOW" | "PEER_PRICE_EXTREME_HIGH" | "SUDDEN_PRICE_DROP" | "SUDDEN_PRICE_INCREASE";

export type PricingAnomalyConfig = Readonly<{
  suspiciousPeerDeviationPct: Prisma.Decimal.Value;
  criticalPeerDeviationPct: Prisma.Decimal.Value;
  suspiciousHistoricalChangePct: Prisma.Decimal.Value;
  criticalHistoricalChangePct: Prisma.Decimal.Value;
}>;

// Explicit, versioned risk policy; callers cannot override it through request data.
export const DEFAULT_PRICING_ANOMALY_CONFIG_V1: PricingAnomalyConfig = Object.freeze({
  suspiciousPeerDeviationPct: "30",
  criticalPeerDeviationPct: "70",
  suspiciousHistoricalChangePct: "30",
  criticalHistoricalChangePct: "70",
});

export type PriceHistoryEvidence = Readonly<{
  previousPrice: Prisma.Decimal.Value | null;
  observationCount: number;
  lastObservedAt: Date | null;
}>;

export type PricingAnomalyEvaluation = Readonly<{
  status: PricingAnomalyStatus;
  severity: Exclude<PricingAnomalyStatus, "INSUFFICIENT_EVIDENCE"> | null;
  confidence: PricingAnomalyConfidence;
  reasons: readonly PricingAnomalyReason[];
  benchmark: Readonly<{ evidenceState: InternalPriceBenchmark["evidenceState"]; comparableCount: number; targetPrice: string; medianPrice: string | null; percentageDifference: string | null }>;
  history: Readonly<{ observationCount: number; previousPrice: string | null; percentageChange: string | null; lastObservedAt: string | null }>;
  evaluatedAt: string;
  algorithmVersion: typeof PRICING_ANOMALY_ALGORITHM_VERSION;
}>;

export class PricingAnomalyError extends Error {
  constructor(readonly code: "INVALID_CONFIG" | "INVALID_HISTORY") { super(code); }
}

function positive(value: Prisma.Decimal.Value) { try { const result = new Prisma.Decimal(value); if (result.lessThanOrEqualTo(0)) throw new Error(); return result; } catch { throw new PricingAnomalyError("INVALID_CONFIG"); } }
function validateConfig(config: PricingAnomalyConfig) {
  const suspiciousPeer = positive(config.suspiciousPeerDeviationPct); const criticalPeer = positive(config.criticalPeerDeviationPct);
  const suspiciousHistory = positive(config.suspiciousHistoricalChangePct); const criticalHistory = positive(config.criticalHistoricalChangePct);
  if (criticalPeer.lessThanOrEqualTo(suspiciousPeer) || criticalHistory.lessThanOrEqualTo(suspiciousHistory)) throw new PricingAnomalyError("INVALID_CONFIG");
  return { suspiciousPeer, criticalPeer, suspiciousHistory, criticalHistory };
}

export function evaluatePricingAnomaly(input: Readonly<{ benchmark: InternalPriceBenchmark; history: PriceHistoryEvidence; evaluatedAt: Date; config?: PricingAnomalyConfig }>): PricingAnomalyEvaluation {
  const thresholds = validateConfig(input.config ?? DEFAULT_PRICING_ANOMALY_CONFIG_V1);
  const target = new Prisma.Decimal(input.benchmark.targetPrice);
  let historicalPct: Prisma.Decimal | null = null;
  if (input.history.previousPrice !== null) {
    const previous = new Prisma.Decimal(input.history.previousPrice);
    if (previous.lessThanOrEqualTo(0)) throw new PricingAnomalyError("INVALID_HISTORY");
    historicalPct = target.minus(previous).div(previous).mul(100).toDecimalPlaces(4);
  }
  const peerPct = input.benchmark.percentageDifference === null ? null : new Prisma.Decimal(input.benchmark.percentageDifference);
  const peerAvailable = input.benchmark.evidenceState === "BENCHMARK_AVAILABLE";
  const reasons: PricingAnomalyReason[] = [];
  let peerSeverity: "NORMAL" | "SUSPICIOUS" | "CRITICAL" = "NORMAL";
  let peerDirection = 0;
  if (!peerAvailable) reasons.push(input.benchmark.evidenceState === "NO_COMPARABLES" ? "NO_COMPARABLES" : "LOW_COMPARABLE_COUNT");
  if (peerAvailable && peerPct) {
    peerDirection = peerPct.comparedTo(0);
    const magnitude = peerPct.abs();
    if (magnitude.greaterThanOrEqualTo(thresholds.criticalPeer)) { peerSeverity = "CRITICAL"; reasons.push(peerDirection < 0 ? "PEER_PRICE_EXTREME_LOW" : "PEER_PRICE_EXTREME_HIGH"); }
    else if (magnitude.greaterThanOrEqualTo(thresholds.suspiciousPeer)) { peerSeverity = "SUSPICIOUS"; reasons.push(peerDirection < 0 ? "PEER_PRICE_LOW" : "PEER_PRICE_HIGH"); }
  }
  let historicalSignal = false; let historicalDirection = 0;
  if (historicalPct) {
    historicalDirection = historicalPct.comparedTo(0);
    if (historicalPct.abs().greaterThanOrEqualTo(thresholds.suspiciousHistory)) { historicalSignal = true; reasons.push(historicalDirection < 0 ? "SUDDEN_PRICE_DROP" : "SUDDEN_PRICE_INCREASE"); }
  }
  let status: PricingAnomalyStatus;
  if (!peerAvailable && !historicalSignal) status = "INSUFFICIENT_EVIDENCE";
  else if (peerSeverity === "CRITICAL") status = "CRITICAL";
  else if (peerSeverity === "SUSPICIOUS" || historicalSignal) status = "SUSPICIOUS";
  else status = "NORMAL";
  const supportingSignals = peerSeverity !== "NORMAL" && historicalSignal && peerDirection === historicalDirection;
  const confidence: PricingAnomalyConfidence = !peerAvailable ? "LOW" : supportingSignals ? "HIGH" : "MEDIUM";
  return Object.freeze({
    status,
    severity: status === "INSUFFICIENT_EVIDENCE" ? null : status,
    confidence,
    reasons: Object.freeze(reasons),
    benchmark: Object.freeze({ evidenceState: input.benchmark.evidenceState, comparableCount: input.benchmark.comparableCount, targetPrice: input.benchmark.targetPrice, medianPrice: input.benchmark.medianPrice, percentageDifference: input.benchmark.percentageDifference }),
    history: Object.freeze({ observationCount: input.history.observationCount, previousPrice: input.history.previousPrice === null ? null : new Prisma.Decimal(input.history.previousPrice).toFixed(2), percentageChange: historicalPct?.toFixed(4) ?? null, lastObservedAt: input.history.lastObservedAt?.toISOString() ?? null }),
    evaluatedAt: input.evaluatedAt.toISOString(),
    algorithmVersion: PRICING_ANOMALY_ALGORITHM_VERSION,
  });
}
