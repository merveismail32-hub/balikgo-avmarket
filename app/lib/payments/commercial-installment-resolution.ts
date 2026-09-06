import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  CANONICAL_INSTALLMENT_COUNTS,
  type InstallmentCount,
  type InstallmentPolicySelection,
} from "../installment-policy";
import { getEffectiveInstallmentCommercialPolicy } from "../installment-commercial-policy";
import { evaluateSellerInstallmentControl, parseInstallmentSet } from "../seller-installment-control";
import { providerInstallmentCapabilityFor } from "./installment-capability";
import { resolveEffectiveInstallments } from "./installment-resolution";

type ReadClient = Pick<PrismaClient, "installmentCommercialPolicy" | "sellerInstallmentControl">;

export type CheckoutInstallmentLine = Readonly<{
  sellerId: string;
  categoryId: string | null;
  sellerOfferId: string;
  eligibleAmount: Prisma.Decimal;
}>;

export type LegalInstallmentConstraint =
  | Readonly<{ status: "KNOWN"; allowedInstallments: unknown; source: string; version: string }>
  | Readonly<{ status: "UNKNOWN" }>;

type ScopeAmount = Readonly<{ scopeKey: string; amount: Prisma.Decimal }>;
const SCOPE_DISPLAY_RANK = { SELLER_OFFER: 0, SELLER_CATEGORY: 1, SELLER: 2, CATEGORY: 3, GLOBAL: 4 } as const;

function intersect(sets: readonly (readonly InstallmentCount[])[]) {
  return Object.freeze(CANONICAL_INSTALLMENT_COUNTS.filter((count) => sets.every((set) => set.includes(count))));
}

function aggregate(lines: readonly CheckoutInstallmentLine[]) {
  const values = new Map<string, Prisma.Decimal>();
  const add = (key: string, amount: Prisma.Decimal) => values.set(key, (values.get(key) ?? new Prisma.Decimal(0)).add(amount));
  for (const line of lines) {
    add("GLOBAL", line.eligibleAmount);
    add(`SELLER:${line.sellerId}`, line.eligibleAmount);
    if (line.categoryId) {
      add(`CATEGORY:${line.categoryId}`, line.eligibleAmount);
      add(`SELLER_CATEGORY:${line.sellerId}:${line.categoryId}`, line.eligibleAmount);
    }
    add(`SELLER_OFFER:${line.sellerOfferId}`, line.eligibleAmount);
  }
  return [...values].map(([scopeKey, amount]): ScopeAmount => ({ scopeKey, amount }));
}

export async function resolveCheckoutCommercialInstallments(input: Readonly<{
  lines: readonly CheckoutInstallmentLine[];
  effectiveAt: Date;
  provider: string;
  requestedInstallmentCount?: unknown;
  legalConstraint?: LegalInstallmentConstraint;
}>, client: ReadClient) {
  if (input.lines.length === 0 || input.lines.some((line) => line.eligibleAmount.isNegative())) {
    throw new Error("INVALID_COMMERCIAL_INSTALLMENT_LINES");
  }

  const selectedPolicies = [];
  for (const scope of aggregate(input.lines)) {
    const policy = await getEffectiveInstallmentCommercialPolicy(
      { scopeKey: scope.scopeKey, amount: scope.amount, at: input.effectiveAt },
      client,
    );
    if (policy) selectedPolicies.push(policy);
  }
  selectedPolicies.sort((left, right) => SCOPE_DISPLAY_RANK[left.scopeType] - SCOPE_DISPLAY_RANK[right.scopeType] || left.scopeKey.localeCompare(right.scopeKey));

  const policySets = selectedPolicies.map((policy) => parseInstallmentSet(policy.allowedInstallments));
  const policyCeiling = intersect(policySets.length ? policySets : [CANONICAL_INSTALLMENT_COUNTS]);
  const sellerIds = [...new Set(input.lines.map((line) => line.sellerId))];
  const controls = await client.sellerInstallmentControl.findMany({ where: { sellerId: { in: sellerIds } } });
  const controlBySeller = new Map(controls.map((control) => [control.sellerId, control]));
  const evaluatedControls = sellerIds.map((sellerId) => {
    const control = controlBySeller.get(sellerId) ?? null;
    return { sellerId, control, result: evaluateSellerInstallmentControl(control) };
  });
  const sellerCeiling = intersect(evaluatedControls.map(({ result }) => result.effectiveAllowedInstallments));
  const commercialAllowedInstallments = intersect([policyCeiling, sellerCeiling]);

  const legalKnown = input.legalConstraint?.status === "KNOWN";
  const legalAllowedInstallments = legalKnown
    ? parseInstallmentSet(input.legalConstraint.allowedInstallments)
    : Object.freeze([1] as const);
  const authoritativeAllowedInstallments = intersect([commercialAllowedInstallments, legalAllowedInstallments]);
  const defaultFallback = selectedPolicies.length === 0 && controls.length === 0;
  const commercialPolicy: InstallmentPolicySelection = Object.freeze({
    valid: true,
    allowedInstallments: authoritativeAllowedInstallments,
    source: defaultFallback ? "DEFAULT_FALLBACK" : "GLOBAL_CONFIG",
    sourceReference: defaultFallback ? "BUILT_IN_SINGLE_PAYMENT" : "MARKETPLACE_ALLOWED_INSTALLMENTS",
    policyVersion: "INSTALLMENT_POLICY_V1",
    fallback: defaultFallback,
    reasonCode: defaultFallback
      ? "DEFAULT_FALLBACK_SELECTED"
      : authoritativeAllowedInstallments.length === 1
      ? "GLOBAL_CONFIG_SELECTED_WITH_SINGLE_PAYMENT"
      : "GLOBAL_CONFIG_SELECTED",
  });
  const resolution = resolveEffectiveInstallments({
    commercialPolicy,
    providerCapability: providerInstallmentCapabilityFor(input.provider),
    requestedInstallmentCount: input.requestedInstallmentCount,
  });

  const internalSnapshot: Prisma.InputJsonObject = {
    schemaVersion: "COMMERCIAL_INSTALLMENT_SNAPSHOT_V1",
    effectiveAt: input.effectiveAt.toISOString(),
    commercialAllowedInstallments: [...commercialAllowedInstallments],
    legalAllowedInstallments: [...legalAllowedInstallments],
    authoritativeAllowedInstallments: [...authoritativeAllowedInstallments],
    policies: selectedPolicies.map((policy) => ({
      id: policy.id,
      version: policy.version,
      scopeType: policy.scopeType,
      scopeKey: policy.scopeKey,
    })),
    sellerControls: evaluatedControls.map(({ sellerId, control, result }) => ({
      sellerId,
      controlId: control?.id ?? null,
      version: result.version,
      conflictReason: result.conflictReason,
    })),
    legal: legalKnown
      ? { status: "KNOWN", source: input.legalConstraint.source, version: input.legalConstraint.version }
      : { status: "UNKNOWN", reason: "LEGAL_CONSTRAINT_UNKNOWN" },
  };

  return Object.freeze({
    resolution,
    commercialAllowedInstallments,
    legalAllowedInstallments,
    internalSnapshot,
  });
}
