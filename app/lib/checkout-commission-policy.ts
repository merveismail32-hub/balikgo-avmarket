import "server-only";

import { type Prisma, type PrismaClient } from "@prisma/client";
import { commissionFor } from "./commission";
import { resolveCommissionPolicy } from "./commission-policy";

type CommissionReadClient = Pick<PrismaClient, "sellerCategoryCommissionAgreement">;

export class CheckoutCommissionAuthorityError extends Error {
  readonly code = "INVALID_COMMISSION_AUTHORITY_CONTEXT" as const;

  constructor() {
    super("INVALID_COMMISSION_AUTHORITY_CONTEXT");
  }
}

export async function commissionForCheckoutLine(
  input: Readonly<{
    sellerId: string;
    categoryId: string | null;
    effectiveAt: Date;
    grossAmount: Prisma.Decimal;
  }>,
  client: CommissionReadClient,
) {
  if (!input.sellerId || !input.categoryId || Number.isNaN(input.effectiveAt.getTime())) {
    throw new CheckoutCommissionAuthorityError();
  }
  const policy = await resolveCommissionPolicy(
    { sellerId: input.sellerId, categoryId: input.categoryId, effectiveAt: input.effectiveAt },
    { client },
  );
  const provenance = policy.source === "SELLER_CATEGORY_AGREEMENT"
    ? Object.freeze({ commissionPolicySource: policy.source, commissionPolicyReference: null, commissionAgreementId: policy.agreementId, commissionAgreementVersion: policy.agreementVersion })
    : Object.freeze({ commissionPolicySource: policy.source, commissionPolicyReference: policy.sourceReference, commissionAgreementId: null, commissionAgreementVersion: null });
  return Object.freeze({ policy, provenance, money: commissionFor(input.grossAmount, 1, policy.rate) });
}
