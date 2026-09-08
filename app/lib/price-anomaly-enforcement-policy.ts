import type { PricingAnomalyEvaluation } from "./pricing-anomaly";

export const PRICE_ANOMALY_ENFORCEMENT_VERSION = "PRICE_ANOMALY_ENFORCEMENT_V1" as const;

export function requiresAutomaticPriceHold(evaluation: Pick<PricingAnomalyEvaluation, "status" | "confidence">) {
  return evaluation.status === "CRITICAL" && evaluation.confidence === "HIGH";
}
