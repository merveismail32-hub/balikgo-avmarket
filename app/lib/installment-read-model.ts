import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { evaluateSellerInstallmentControl, parseInstallmentSet } from "./seller-installment-control";
import { resolveCheckoutCommercialInstallments } from "./payments/commercial-installment-resolution";

type Client = PrismaClient | Prisma.TransactionClient;
export class InstallmentReadModelError extends Error {
  constructor(readonly code: "FORBIDDEN" | "SELLER_NOT_FOUND" | "OFFER_NOT_FOUND" | "INVALID_PAGE") { super(code); }
}

export function toCustomerInstallmentReadModel(input: Readonly<{ effectiveInstallmentOptions: readonly number[]; selectedInstallmentCount?: number | null; availabilityReason?: "AVAILABLE" | "SINGLE_PAYMENT_ONLY" }>) {
  return Object.freeze({
    effectiveInstallmentOptions: Object.freeze([...input.effectiveInstallmentOptions]),
    selectedInstallmentCount: input.selectedInstallmentCount ?? null,
    availabilityReason: input.availabilityReason ?? (input.effectiveInstallmentOptions.length > 1 ? "AVAILABLE" : "SINGLE_PAYMENT_ONLY"),
  });
}

function pageSize(raw: unknown) {
  const value = raw === undefined ? 20 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new InstallmentReadModelError("INVALID_PAGE");
  return value;
}

function safeState(raw: Prisma.JsonValue | null) {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  const value = raw as Prisma.JsonObject;
  return {
    authorizationMode: typeof value.authorizationMode === "string" ? value.authorizationMode : undefined,
    delegatedAllowedInstallments: Array.isArray(value.delegatedAllowedInstallments) ? value.delegatedAllowedInstallments : undefined,
    participationEnabled: typeof value.participationEnabled === "boolean" ? value.participationEnabled : undefined,
    sellerPreferenceAllowedInstallments: Array.isArray(value.sellerPreferenceAllowedInstallments) ? value.sellerPreferenceAllowedInstallments : undefined,
    scopeType: typeof value.scopeType === "string" ? value.scopeType : undefined,
    allowedInstallments: Array.isArray(value.allowedInstallments) ? value.allowedInstallments : undefined,
    minimumEligibleAmount: typeof value.minimumEligibleAmount === "string" ? value.minimumEligibleAmount : undefined,
    maximumEligibleAmount: typeof value.maximumEligibleAmount === "string" || value.maximumEligibleAmount === null ? value.maximumEligibleAmount : undefined,
    effectiveFrom: typeof value.effectiveFrom === "string" ? value.effectiveFrom : undefined,
    effectiveUntil: typeof value.effectiveUntil === "string" || value.effectiveUntil === null ? value.effectiveUntil : undefined,
    approvedFromRequestId: typeof value.approvedFromRequestId === "string" || value.approvedFromRequestId === null ? value.approvedFromRequestId : undefined,
    version: typeof value.version === "number" ? value.version : undefined,
  };
}

async function assertAdmin(actorUserId: string, client: Client) {
  if ((await client.user.findUnique({ where: { id: actorUserId }, select: { role: true } }))?.role !== "ADMIN") {
    throw new InstallmentReadModelError("FORBIDDEN");
  }
}

export async function getAdminInstallmentOverview(input: Readonly<{
  actorUserId: string;
  sellerId?: string;
  limit?: unknown;
  cursor?: string;
  now?: Date;
  offerId?: string;
  amount?: unknown;
}>, client: Client = prisma) {
  await assertAdmin(input.actorUserId, client);
  const take = pageSize(input.limit);
  const now = input.now ?? new Date();
  const [sellers, globalPolicies] = await Promise.all([client.sellerProfile.findMany({
    where: input.sellerId ? { id: input.sellerId } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    take: take + 1,
    select: {
      id: true, storeName: true, storeSlug: true,
      installmentControl: { select: { id: true, authorizationMode: true, delegatedAllowedInstallments: true, participationEnabled: true, sellerPreferenceAllowedInstallments: true, version: true, updatedAt: true } },
      installmentRequests: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, scopeType: true, sellerOfferId: true, requestedAllowedInstallments: true, approvedAllowedInstallments: true, status: true, version: true, createdAt: true, decidedAt: true, sellerReason: true, decisionReason: true } },
      installmentPolicies: { orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], take: 20, select: { id: true, scopeType: true, sellerOfferId: true, categoryId: true, allowedInstallments: true, minimumEligibleAmount: true, maximumEligibleAmount: true, effectiveFrom: true, effectiveUntil: true, version: true, approvedFromRequestId: true, reason: true } },
    },
  }), client.installmentCommercialPolicy.findMany({ where: { scopeKey: "GLOBAL" }, orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], take: 20, select: { id: true, scopeType: true, allowedInstallments: true, minimumEligibleAmount: true, maximumEligibleAmount: true, effectiveFrom: true, effectiveUntil: true, version: true, reason: true } })]);
  const hasMore = sellers.length > take;
  const items = sellers.slice(0, take).map((seller) => {
    const evaluated = evaluateSellerInstallmentControl(seller.installmentControl);
    return {
      seller: { id: seller.id, storeName: seller.storeName, storeSlug: seller.storeSlug },
      control: seller.installmentControl ? {
        id: seller.installmentControl.id,
        authorizationMode: seller.installmentControl.authorizationMode,
        delegatedAllowedInstallments: parseInstallmentSet(seller.installmentControl.delegatedAllowedInstallments),
        participationEnabled: seller.installmentControl.participationEnabled,
        sellerPreferenceAllowedInstallments: parseInstallmentSet(seller.installmentControl.sellerPreferenceAllowedInstallments),
        version: seller.installmentControl.version,
        updatedAt: seller.installmentControl.updatedAt,
      } : null,
      effectiveControlAllowance: evaluated.effectiveAllowedInstallments,
      conflicts: [
        ...(evaluated.conflictReason ? [evaluated.conflictReason] : []),
        ...(!seller.installmentControl ? ["CONTROL_MISSING"] : []),
        ...(seller.installmentControl?.authorizationMode === "REQUEST_ONLY" ? ["REQUEST_ONLY"] : []),
        ...(seller.installmentControl?.authorizationMode === "DISABLED" ? ["DISABLED"] : []),
        ...(seller.installmentRequests.some((request) => request.status === "SUBMITTED") ? ["REQUEST_PENDING"] : []),
        ...(!seller.installmentPolicies.some((policy) => policy.effectiveFrom <= now && (!policy.effectiveUntil || policy.effectiveUntil > now)) ? ["NO_ACTIVE_POLICY"] : []),
        ...(seller.installmentPolicies.some((policy) => policy.effectiveFrom > now) ? ["FUTURE_POLICY_SCHEDULED"] : []),
      ],
      requests: seller.installmentRequests.map((request) => ({ ...request, requestedAllowedInstallments: parseInstallmentSet(request.requestedAllowedInstallments), approvedAllowedInstallments: request.approvedAllowedInstallments ? parseInstallmentSet(request.approvedAllowedInstallments) : null })),
      policies: seller.installmentPolicies.map((policy) => ({ ...policy, allowedInstallments: parseInstallmentSet(policy.allowedInstallments), minimumEligibleAmount: policy.minimumEligibleAmount.toString(), maximumEligibleAmount: policy.maximumEligibleAmount?.toString() ?? null, state: policy.effectiveFrom > now ? "SCHEDULED" : policy.effectiveUntil && policy.effectiveUntil <= now ? "EXPIRED" : "ACTIVE" })),
    };
  });
  let effectiveOutcome = null;
  if (input.offerId) {
    if (!input.sellerId || input.amount === undefined) throw new InstallmentReadModelError("INVALID_PAGE");
    const offer = await client.sellerOffer.findFirst({ where: { id: input.offerId, sellerId: input.sellerId }, select: { id: true, sellerId: true, catalogProduct: { select: { categoryId: true } } } });
    if (!offer) throw new InstallmentReadModelError("OFFER_NOT_FOUND");
    const amount = new Prisma.Decimal(input.amount as string);
    if (!amount.isFinite() || amount.isNegative()) throw new InstallmentReadModelError("INVALID_PAGE");
    const decision = await resolveCheckoutCommercialInstallments({ lines: [{ sellerId: offer.sellerId, categoryId: offer.catalogProduct.categoryId, sellerOfferId: offer.id, eligibleAmount: amount }], effectiveAt: now, provider: "TEST", legalConstraint: { status: "UNKNOWN" } }, client as PrismaClient);
    effectiveOutcome = { commercialAllowedInstallments: decision.commercialAllowedInstallments, effectiveInstallmentOptions: decision.resolution.effectiveAllowedInstallments, effectiveAt: now, appliedPolicies: decision.internalSnapshot.policies };
  }
  return { items, globalPolicies: globalPolicies.map((policy) => ({ ...policy, allowedInstallments: parseInstallmentSet(policy.allowedInstallments), minimumEligibleAmount: policy.minimumEligibleAmount.toString(), maximumEligibleAmount: policy.maximumEligibleAmount?.toString() ?? null, state: policy.effectiveFrom > now ? "SCHEDULED" : policy.effectiveUntil && policy.effectiveUntil <= now ? "EXPIRED" : "ACTIVE" })), effectiveOutcome, page: { limit: take, hasMore, nextCursor: hasMore ? items.at(-1)?.seller.id ?? null : null } };
}

export async function getSellerInstallmentReadModel(input: Readonly<{
  actorUserId: string;
  offerId?: string;
  amount?: unknown;
  now?: Date;
}>, client: Client = prisma) {
  const actor = await client.user.findUnique({ where: { id: input.actorUserId }, select: { role: true, sellerProfile: { select: { id: true, storeName: true, storeSlug: true } } } });
  if (actor?.role !== "SELLER" || !actor.sellerProfile) throw new InstallmentReadModelError("FORBIDDEN");
  const sellerId = actor.sellerProfile.id;
  const [control, requests, policies] = await Promise.all([
    client.sellerInstallmentControl.findUnique({ where: { sellerId } }),
    client.sellerInstallmentRequest.findMany({ where: { sellerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, scopeType: true, sellerOfferId: true, requestedAllowedInstallments: true, approvedAllowedInstallments: true, status: true, version: true, createdAt: true, decidedAt: true } }),
    client.installmentCommercialPolicy.findMany({ where: { sellerId }, orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], take: 20, select: { scopeType: true, sellerOfferId: true, allowedInstallments: true, effectiveFrom: true, effectiveUntil: true } }),
  ]);
  const evaluated = evaluateSellerInstallmentControl(control);
  let effectiveView = null;
  if (input.offerId) {
    const offer = await client.sellerOffer.findFirst({ where: { id: input.offerId, sellerId }, select: { id: true, sellerId: true, catalogProduct: { select: { categoryId: true } } } });
    if (!offer) throw new InstallmentReadModelError("OFFER_NOT_FOUND");
    const amount = new Prisma.Decimal(input.amount as string);
    if (!amount.isFinite() || amount.isNegative()) throw new InstallmentReadModelError("INVALID_PAGE");
    const decision = await resolveCheckoutCommercialInstallments({ lines: [{ sellerId, categoryId: offer.catalogProduct.categoryId, sellerOfferId: offer.id, eligibleAmount: amount }], effectiveAt: input.now ?? new Date(), provider: "TEST", legalConstraint: { status: "UNKNOWN" } }, client as PrismaClient);
    effectiveView = { commercialAllowedInstallments: decision.commercialAllowedInstallments, effectiveInstallmentOptions: decision.resolution.effectiveAllowedInstallments, effectiveAt: input.now ?? new Date(), nextRelevantChange: policies.filter((policy) => policy.effectiveFrom > (input.now ?? new Date())).at(0)?.effectiveFrom ?? null };
  }
  return {
    seller: actor.sellerProfile,
    control: control ? { authorizationMode: control.authorizationMode, delegatedAllowedInstallments: parseInstallmentSet(control.delegatedAllowedInstallments), participationEnabled: control.participationEnabled, sellerPreferenceAllowedInstallments: parseInstallmentSet(control.sellerPreferenceAllowedInstallments), version: control.version } : null,
    effectiveControlAllowance: evaluated.effectiveAllowedInstallments,
    conflictReason: evaluated.conflictReason ?? (!control ? "CONTROL_MISSING" : control.authorizationMode === "DELEGATED" ? null : control.authorizationMode),
    requests: requests.map((request) => ({ ...request, requestedAllowedInstallments: parseInstallmentSet(request.requestedAllowedInstallments), approvedAllowedInstallments: request.approvedAllowedInstallments ? parseInstallmentSet(request.approvedAllowedInstallments) : null })),
    policyEffects: policies.map((policy) => ({ scopeType: policy.scopeType, sellerOfferId: policy.sellerOfferId, allowedInstallments: parseInstallmentSet(policy.allowedInstallments), effectiveFrom: policy.effectiveFrom, effectiveUntil: policy.effectiveUntil })),
    effectiveView,
  };
}

export async function getAdminInstallmentAuditTimeline(input: Readonly<{ actorUserId: string; sellerId: string; limit?: unknown; offset?: unknown }>, client: Client = prisma) {
  await assertAdmin(input.actorUserId, client);
  const take = pageSize(input.limit);
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  if (!Number.isInteger(offset) || offset < 0 || offset > 500) throw new InstallmentReadModelError("INVALID_PAGE");
  const seller = await client.sellerProfile.findUnique({ where: { id: input.sellerId }, select: { id: true, storeName: true, storeSlug: true } });
  if (!seller) throw new InstallmentReadModelError("SELLER_NOT_FOUND");
  const policyIds = (await client.installmentCommercialPolicy.findMany({ where: { sellerId: input.sellerId }, take: 100, select: { id: true } })).map((policy) => policy.id);
  const [controls, requests, policies] = await Promise.all([
    client.sellerInstallmentControlAudit.findMany({ where: { sellerId: input.sellerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: offset + take + 1, select: { id: true, createdAt: true, actorRole: true, action: true, previousState: true, newState: true, previousVersion: true, newVersion: true, reason: true, controlId: true } }),
    client.sellerInstallmentRequestAudit.findMany({ where: { sellerId: input.sellerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: offset + take + 1, select: { id: true, createdAt: true, actorRole: true, action: true, previousStatus: true, newStatus: true, requestedSet: true, approvedSet: true, previousVersion: true, newVersion: true, reason: true, requestId: true } }),
    client.installmentCommercialPolicyAudit.findMany({ where: { policyId: { in: policyIds } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: offset + take + 1, select: { id: true, createdAt: true, actorRole: true, action: true, previousState: true, newState: true, previousVersion: true, newVersion: true, reason: true, policyId: true } }),
  ]);
  const timeline = [
    ...controls.map((audit) => ({ id: audit.id, sourceType: "CONTROL" as const, timestamp: audit.createdAt, actorRole: audit.actorRole, action: audit.action, targetReference: audit.controlId, previousState: safeState(audit.previousState), newState: safeState(audit.newState), previousVersion: audit.previousVersion, newVersion: audit.newVersion, reason: audit.reason })),
    ...requests.map((audit) => ({ id: audit.id, sourceType: "REQUEST" as const, timestamp: audit.createdAt, actorRole: audit.actorRole, action: audit.action, targetReference: audit.requestId, previousState: audit.previousStatus ? { status: audit.previousStatus } : null, newState: { status: audit.newStatus, requestedSet: parseInstallmentSet(audit.requestedSet), approvedSet: audit.approvedSet ? parseInstallmentSet(audit.approvedSet) : null }, previousVersion: audit.previousVersion, newVersion: audit.newVersion, reason: audit.reason })),
    ...policies.map((audit) => ({ id: audit.id, sourceType: "POLICY" as const, timestamp: audit.createdAt, actorRole: audit.actorRole, action: audit.action, targetReference: audit.policyId, previousState: safeState(audit.previousState), newState: safeState(audit.newState), previousVersion: audit.previousVersion, newVersion: audit.newVersion, reason: audit.reason })),
  ].sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime() || right.id.localeCompare(left.id));
  return { seller, items: timeline.slice(offset, offset + take), page: { limit: take, offset, hasMore: timeline.length > offset + take, nextOffset: timeline.length > offset + take ? offset + take : null } };
}
