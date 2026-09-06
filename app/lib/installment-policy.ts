import "server-only";

export const CANONICAL_INSTALLMENT_COUNTS = Object.freeze([1, 3, 6, 9] as const);
export type InstallmentCount = (typeof CANONICAL_INSTALLMENT_COUNTS)[number];

export type InstallmentPolicySource = "GLOBAL_CONFIG" | "DEFAULT_FALLBACK";
export type InstallmentPolicyReasonCode =
  | "GLOBAL_CONFIG_SELECTED"
  | "GLOBAL_CONFIG_SELECTED_WITH_SINGLE_PAYMENT"
  | "DEFAULT_FALLBACK_SELECTED";

export type InstallmentPolicySelection = Readonly<{
  valid: true;
  allowedInstallments: readonly InstallmentCount[];
  source: InstallmentPolicySource;
  sourceReference: "MARKETPLACE_ALLOWED_INSTALLMENTS" | "BUILT_IN_SINGLE_PAYMENT";
  policyVersion: "INSTALLMENT_POLICY_V1";
  fallback: boolean;
  reasonCode: InstallmentPolicyReasonCode;
}>;

export class InstallmentPolicyConfigError extends Error {
  readonly code = "INVALID_INSTALLMENT_POLICY_CONFIG" as const;

  constructor() {
    super("INVALID_INSTALLMENT_POLICY_CONFIG");
  }
}

export function parseInstallmentCount(raw: unknown): InstallmentCount {
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^(1|3|6|9)$/.test(raw)
      ? Number(raw)
      : Number.NaN;

  if (!Number.isInteger(value) || !CANONICAL_INSTALLMENT_COUNTS.includes(value as InstallmentCount)) {
    throw new InstallmentPolicyConfigError();
  }
  return value as InstallmentCount;
}

export function parseAllowedInstallments(raw: string): readonly InstallmentCount[] {
  if (raw.length === 0) throw new InstallmentPolicyConfigError();

  const tokens = raw.split(",");
  if (tokens.some((token) => token.length === 0)) throw new InstallmentPolicyConfigError();

  const configured = tokens.map(parseInstallmentCount);
  const canonical = CANONICAL_INSTALLMENT_COUNTS.filter(
    (count) => count === 1 || configured.includes(count),
  );
  return Object.freeze([...canonical]);
}

export function selectInstallmentPolicyFromServerConfig(
  configuredAllowedInstallments: string | undefined,
): InstallmentPolicySelection {
  const fallback = configuredAllowedInstallments === undefined;
  const allowedInstallments = fallback
    ? Object.freeze([1] as const)
    : parseAllowedInstallments(configuredAllowedInstallments);
  const addedSinglePayment = !fallback && !configuredAllowedInstallments.split(",").includes("1");

  return Object.freeze({
    valid: true,
    allowedInstallments,
    source: fallback ? "DEFAULT_FALLBACK" : "GLOBAL_CONFIG",
    sourceReference: fallback ? "BUILT_IN_SINGLE_PAYMENT" : "MARKETPLACE_ALLOWED_INSTALLMENTS",
    policyVersion: "INSTALLMENT_POLICY_V1",
    fallback,
    reasonCode: fallback
      ? "DEFAULT_FALLBACK_SELECTED"
      : addedSinglePayment
        ? "GLOBAL_CONFIG_SELECTED_WITH_SINGLE_PAYMENT"
        : "GLOBAL_CONFIG_SELECTED",
  });
}

export function resolveGlobalInstallmentPolicy(
  configuredAllowedInstallments = process.env.MARKETPLACE_ALLOWED_INSTALLMENTS,
) {
  return selectInstallmentPolicyFromServerConfig(configuredAllowedInstallments);
}
