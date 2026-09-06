import "server-only";

import { Prisma, type PrismaClient, type SellerInstallmentRequestScope } from "@prisma/client";
import { prisma } from "./prisma";
import { parseInstallmentSet, SellerInstallmentControlError } from "./seller-installment-control";

export type SellerInstallmentRequestErrorCode = "FORBIDDEN" | "SELLER_NOT_FOUND" | "OFFER_NOT_FOUND" | "REQUEST_NOT_FOUND" | "INVALID_SCOPE" | "INVALID_REASON" | "INVALID_ALLOWED_INSTALLMENTS" | "ALREADY_AUTHORIZED" | "ACTIVE_REQUEST_EXISTS" | "APPROVAL_OUTSIDE_REQUEST" | "CONTROL_NOT_FOUND" | "STALE_VERSION" | "TERMINAL_REQUEST" | "CONCURRENT_CHANGE";
export class SellerInstallmentRequestError extends Error { constructor(readonly code: SellerInstallmentRequestErrorCode) { super(code); } }
type Host = Pick<PrismaClient, "$transaction">;
const reason = (raw: unknown) => { if (typeof raw !== "string" || raw.trim().length < 3 || raw.trim().length > 500) throw new SellerInstallmentRequestError("INVALID_REASON"); return raw.trim(); };
const version = (raw: unknown) => { if (!Number.isInteger(raw) || (raw as number) < 1) throw new SellerInstallmentRequestError("STALE_VERSION"); return raw as number; };
const set = (raw: unknown) => { try { return parseInstallmentSet(raw); } catch (error) { if (error instanceof SellerInstallmentControlError) throw new SellerInstallmentRequestError("INVALID_ALLOWED_INSTALLMENTS"); throw error; } };
const serial = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || (error.code === "P2010" && JSON.stringify(error.meta ?? {}).includes("40001")));
const scopeKey = (sellerId: string, scope: SellerInstallmentRequestScope, offerId?: string | null) => scope === "SELLER" ? `SELLER:${sellerId}` : `SELLER_OFFER:${offerId}`;

async function actorSeller(tx: Prisma.TransactionClient, actorUserId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true, sellerProfile: { select: { id: true } } } });
  if (actor?.role !== "SELLER" || !actor.sellerProfile) throw new SellerInstallmentRequestError("FORBIDDEN");
  await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${actor.sellerProfile.id} FOR UPDATE`;
  return { role: actor.role, sellerId: actor.sellerProfile.id } as const;
}
async function admin(tx: Prisma.TransactionClient, actorUserId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
  if (actor?.role !== "ADMIN") throw new SellerInstallmentRequestError("FORBIDDEN");
  return actor.role;
}

export async function submitSellerInstallmentRequest(input: Readonly<{ actorUserId: string; scopeType: unknown; sellerOfferId?: unknown; requestedAllowedInstallments: unknown; reason: unknown }>, client: Host = prisma) {
  if (input.scopeType !== "SELLER" && input.scopeType !== "SELLER_OFFER") throw new SellerInstallmentRequestError("INVALID_SCOPE");
  const scope = input.scopeType; const requested = set(input.requestedAllowedInstallments); const sellerReason = reason(input.reason);
  if (requested.length === 1) throw new SellerInstallmentRequestError("ALREADY_AUTHORIZED");
  try { return await client.$transaction(async (tx) => {
    const actor = await actorSeller(tx, input.actorUserId);
    let sellerOfferId: string | null = null;
    if (scope === "SELLER_OFFER") {
      if (typeof input.sellerOfferId !== "string") throw new SellerInstallmentRequestError("OFFER_NOT_FOUND");
      const offer = await tx.sellerOffer.findFirst({ where: { id: input.sellerOfferId, sellerId: actor.sellerId }, select: { id: true } });
      if (!offer) throw new SellerInstallmentRequestError("OFFER_NOT_FOUND"); sellerOfferId = offer.id;
    } else if (input.sellerOfferId !== undefined && input.sellerOfferId !== null) throw new SellerInstallmentRequestError("INVALID_SCOPE");
    const control = await tx.sellerInstallmentControl.findUnique({ where: { sellerId: actor.sellerId } });
    const delegated = control?.authorizationMode === "DELEGATED" ? set(control.delegatedAllowedInstallments) : [1];
    if (requested.every((count) => delegated.includes(count))) throw new SellerInstallmentRequestError("ALREADY_AUTHORIZED");
    const activeScopeKey = scopeKey(actor.sellerId, scope, sellerOfferId);
    const active = await tx.sellerInstallmentRequest.findUnique({ where: { activeScopeKey } });
    if (active) {
      if (JSON.stringify(set(active.requestedAllowedInstallments)) === JSON.stringify(requested)) return Object.freeze({ ...active, idempotent: true });
      throw new SellerInstallmentRequestError("ACTIVE_REQUEST_EXISTS");
    }
    const created = await tx.sellerInstallmentRequest.create({ data: { sellerId: actor.sellerId, scopeType: scope, sellerOfferId, activeScopeKey, requestedAllowedInstallments: [...requested], sellerReason } });
    await tx.sellerInstallmentRequestAudit.create({ data: { requestId: created.id, sellerId: actor.sellerId, actorUserId: input.actorUserId, actorRole: actor.role, action: "REQUEST_SUBMITTED", newStatus: "SUBMITTED", requestedSet: [...requested], newVersion: 1, reason: sellerReason } });
    return Object.freeze({ ...created, idempotent: false });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (serial(error)) throw new SellerInstallmentRequestError("CONCURRENT_CHANGE"); throw error; }
}

export async function cancelOwnSellerInstallmentRequest(input: Readonly<{ actorUserId: string; requestId: string; expectedVersion: unknown; reason: unknown }>, client: Host = prisma) {
  const expectedVersion = version(input.expectedVersion); const why = reason(input.reason);
  try { return await client.$transaction(async (tx) => {
    const actor = await actorSeller(tx, input.actorUserId);
    await tx.$queryRaw`SELECT "id" FROM "SellerInstallmentRequest" WHERE "id" = ${input.requestId} FOR UPDATE`;
    const current = await tx.sellerInstallmentRequest.findFirst({ where: { id: input.requestId, sellerId: actor.sellerId } });
    if (!current) throw new SellerInstallmentRequestError("REQUEST_NOT_FOUND");
    if (current.status !== "SUBMITTED") throw new SellerInstallmentRequestError("TERMINAL_REQUEST");
    if (current.version !== expectedVersion) throw new SellerInstallmentRequestError("STALE_VERSION");
    const changed = await tx.sellerInstallmentRequest.updateMany({ where: { id: current.id, sellerId: actor.sellerId, status: "SUBMITTED", version: expectedVersion }, data: { status: "CANCELLED", activeScopeKey: null, decidedAt: new Date(), decisionReason: why, version: { increment: 1 } } });
    if (changed.count !== 1) throw new SellerInstallmentRequestError("STALE_VERSION");
    const updated = await tx.sellerInstallmentRequest.findUniqueOrThrow({ where: { id: current.id } });
    await tx.sellerInstallmentRequestAudit.create({ data: { requestId: current.id, sellerId: actor.sellerId, actorUserId: input.actorUserId, actorRole: actor.role, action: "REQUEST_CANCELLED", previousStatus: "SUBMITTED", newStatus: "CANCELLED", requestedSet: [...set(current.requestedAllowedInstallments)], expectedVersion, previousVersion: current.version, newVersion: updated.version, reason: why } }); return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (serial(error)) throw new SellerInstallmentRequestError("CONCURRENT_CHANGE"); throw error; }
}

export async function decideSellerInstallmentRequest(input: Readonly<{ actorUserId: string; requestId: string; decision: "APPROVE" | "REJECT"; approvedAllowedInstallments?: unknown; expectedVersion: unknown; expectedControlVersion?: unknown; reason: unknown }>, client: Host = prisma) {
  const expectedVersion = version(input.expectedVersion); const why = reason(input.reason); const approved = input.decision === "APPROVE" ? set(input.approvedAllowedInstallments) : null;
  try { return await client.$transaction(async (tx) => {
    const actorRole = await admin(tx, input.actorUserId);
    await tx.$queryRaw`SELECT "id" FROM "SellerInstallmentRequest" WHERE "id" = ${input.requestId} FOR UPDATE`;
    const current = await tx.sellerInstallmentRequest.findUnique({ where: { id: input.requestId } });
    if (!current) throw new SellerInstallmentRequestError("REQUEST_NOT_FOUND");
    if (current.status !== "SUBMITTED") throw new SellerInstallmentRequestError("TERMINAL_REQUEST");
    if (current.version !== expectedVersion) throw new SellerInstallmentRequestError("STALE_VERSION");
    const requested = set(current.requestedAllowedInstallments);
    if (approved && approved.some((count) => !requested.includes(count))) throw new SellerInstallmentRequestError("APPROVAL_OUTSIDE_REQUEST");
    let approvedControlId: string | null = null; let approvedControlVersion: number | null = null;
    if (approved && current.scopeType === "SELLER") {
      const expectedControlVersion = version(input.expectedControlVersion);
      await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${current.sellerId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "SellerInstallmentControl" WHERE "sellerId" = ${current.sellerId} FOR UPDATE`;
      const control = await tx.sellerInstallmentControl.findUnique({ where: { sellerId: current.sellerId } });
      if (!control) throw new SellerInstallmentRequestError("CONTROL_NOT_FOUND");
      if (control.version !== expectedControlVersion) throw new SellerInstallmentRequestError("STALE_VERSION");
      const changed = await tx.sellerInstallmentControl.updateMany({ where: { id: control.id, version: expectedControlVersion }, data: { authorizationMode: "DELEGATED", delegatedAllowedInstallments: [...approved], version: { increment: 1 } } });
      if (changed.count !== 1) throw new SellerInstallmentRequestError("STALE_VERSION");
      approvedControlId = control.id; approvedControlVersion = control.version + 1;
      await tx.sellerInstallmentControlAudit.create({ data: { controlId: control.id, sellerId: current.sellerId, actorUserId: input.actorUserId, actorRole, action: "REQUEST_APPROVED_AUTHORIZATION", previousState: { authorizationMode: control.authorizationMode, delegatedAllowedInstallments: control.delegatedAllowedInstallments, participationEnabled: control.participationEnabled, sellerPreferenceAllowedInstallments: control.sellerPreferenceAllowedInstallments, version: control.version }, newState: { authorizationMode: "DELEGATED", delegatedAllowedInstallments: [...approved], participationEnabled: control.participationEnabled, sellerPreferenceAllowedInstallments: control.sellerPreferenceAllowedInstallments, version: approvedControlVersion }, expectedVersion: expectedControlVersion, previousVersion: control.version, newVersion: approvedControlVersion, reason: `${why} [request:${current.id}]` } });
    }
    const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const changed = await tx.sellerInstallmentRequest.updateMany({ where: { id: current.id, status: "SUBMITTED", version: expectedVersion }, data: { status, activeScopeKey: null, approvedAllowedInstallments: approved ? [...approved] : Prisma.DbNull, decidedByUserId: input.actorUserId, decidedAt: new Date(), decisionReason: why, approvedControlId, approvedControlVersion, version: { increment: 1 } } });
    if (changed.count !== 1) throw new SellerInstallmentRequestError("STALE_VERSION");
    const updated = await tx.sellerInstallmentRequest.findUniqueOrThrow({ where: { id: current.id } });
    await tx.sellerInstallmentRequestAudit.create({ data: { requestId: current.id, sellerId: current.sellerId, actorUserId: input.actorUserId, actorRole, action: status === "APPROVED" ? "REQUEST_APPROVED" : "REQUEST_REJECTED", previousStatus: "SUBMITTED", newStatus: status, requestedSet: [...requested], approvedSet: approved ? [...approved] : Prisma.DbNull, expectedVersion, previousVersion: current.version, newVersion: updated.version, reason: why } }); return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (serial(error)) throw new SellerInstallmentRequestError("CONCURRENT_CHANGE"); throw error; }
}
