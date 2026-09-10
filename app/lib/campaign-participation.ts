import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { campaignEvidence } from "./campaign-domain";

export type CampaignParticipationErrorCode = "FORBIDDEN" | "INVALID_INPUT" | "CAMPAIGN_NOT_OPEN" | "OFFER_NOT_FOUND" | "PARTICIPATION_NOT_FOUND" | "ALREADY_TARGETED" | "ACTIVE_PARTICIPATION_EXISTS" | "STALE_VERSION" | "TERMINAL_PARTICIPATION" | "TARGET_MISMATCH" | "CONCURRENT_CHANGE";
export class CampaignParticipationError extends Error { constructor(readonly code: CampaignParticipationErrorCode) { super(code); } }
type Host = Pick<PrismaClient, "$transaction">;
const id = z.string().min(1).max(191);
const expectedVersion = z.number().int().positive().max(2147483646);
const optionalReason = z.string().trim().max(500).optional();
const submitSchema = z.object({ campaignId: id, sellerOfferId: id }).strict();
const cancelSchema = z.object({ expectedVersion, reason: optionalReason }).strict();
const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), expectedVersion, expectedCampaignVersion: expectedVersion.optional(), reason: optionalReason }).strict();
const revokeSchema = z.object({ expectedVersion, expectedCampaignVersion: expectedVersion, reason: z.string().trim().min(3).max(500) }).strict();
const parse = <T>(schema: z.ZodType<T>, value: unknown) => { const result = schema.safeParse(value); if (!result.success) throw new CampaignParticipationError("INVALID_INPUT"); return result.data; };
const serial = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002" || (error.code === "P2010" && JSON.stringify(error.meta ?? {}).includes("40001")));
const key = (campaignId: string, sellerOfferId: string) => `${campaignId}:${sellerOfferId}`;

async function sellerActor(tx: Prisma.TransactionClient, actorUserId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true, sellerProfile: { select: { id: true } } } });
  if (actor?.role !== "SELLER" || !actor.sellerProfile) throw new CampaignParticipationError("FORBIDDEN");
  return { role: actor.role, sellerId: actor.sellerProfile.id } as const;
}
async function adminActor(tx: Prisma.TransactionClient, actorUserId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
  if (actor?.role !== "ADMIN") throw new CampaignParticipationError("FORBIDDEN");
  return actor.role;
}
const sellerSelect = { id: true, campaignId: true, sellerOfferId: true, status: true, version: true, createdAt: true, updatedAt: true, campaign: { select: { effectiveFrom: true, effectiveUntil: true } }, sellerOffer: { select: { sellerSku: true, catalogProduct: { select: { name: true } } } } } satisfies Prisma.CampaignParticipationSelect;

export async function submitCampaignParticipation(actorUserId: string, payload: unknown, client: Host = prisma) {
  const input = parse(submitSchema, payload);
  try { return await client.$transaction(async tx => {
    const actor = await sellerActor(tx, actorUserId);
    await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${actor.sellerId} FOR UPDATE`;
    const offer = await tx.sellerOffer.findFirst({ where: { id: input.sellerOfferId, sellerId: actor.sellerId }, select: { id: true } });
    if (!offer) throw new CampaignParticipationError("OFFER_NOT_FOUND");
    const campaign = await tx.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true, status: true, effectiveUntil: true, sellerOfferTargets: { where: { sellerOfferId: offer.id }, select: { id: true }, take: 1 } } });
    if (!campaign || campaign.status !== "PUBLISHED" || campaign.effectiveUntil <= new Date()) throw new CampaignParticipationError("CAMPAIGN_NOT_OPEN");
    if (campaign.sellerOfferTargets.length) throw new CampaignParticipationError("ALREADY_TARGETED");
    const activeKey = key(campaign.id, offer.id);
    const active = await tx.campaignParticipation.findUnique({ where: { activeKey }, select: sellerSelect });
    if (active) return { ...active, idempotent: true };
    const created = await tx.campaignParticipation.create({ data: { campaignId: campaign.id, sellerId: actor.sellerId, sellerOfferId: offer.id, activeKey }, select: sellerSelect });
    await tx.campaignParticipationAudit.create({ data: { participationId: created.id, campaignId: campaign.id, sellerId: actor.sellerId, sellerOfferId: offer.id, actorUserId, actorRole: actor.role, action: "PARTICIPATION_REQUESTED", newStatus: "REQUESTED", newVersion: 1 } });
    return { ...created, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (serial(error)) throw new CampaignParticipationError("CONCURRENT_CHANGE"); throw error; }
}

export async function cancelOwnCampaignParticipation(actorUserId: string, participationId: string, payload: unknown, client: Host = prisma) {
  const input = parse(cancelSchema, payload);
  try { return await client.$transaction(async tx => {
    const actor = await sellerActor(tx, actorUserId);
    await tx.$queryRaw`SELECT "id" FROM "CampaignParticipation" WHERE "id" = ${participationId} FOR UPDATE`;
    const current = await tx.campaignParticipation.findFirst({ where: { id: participationId, sellerId: actor.sellerId } });
    if (!current) throw new CampaignParticipationError("PARTICIPATION_NOT_FOUND");
    if (current.status !== "REQUESTED") throw new CampaignParticipationError("TERMINAL_PARTICIPATION");
    if (current.version !== input.expectedVersion) throw new CampaignParticipationError("STALE_VERSION");
    const changed = await tx.campaignParticipation.updateMany({ where: { id: current.id, sellerId: actor.sellerId, status: "REQUESTED", version: input.expectedVersion }, data: { status: "CANCELLED", activeKey: null, decisionReason: input.reason || null, decidedAt: new Date(), version: { increment: 1 } } });
    if (changed.count !== 1) throw new CampaignParticipationError("STALE_VERSION");
    const updated = await tx.campaignParticipation.findUniqueOrThrow({ where: { id: current.id }, select: sellerSelect });
    await tx.campaignParticipationAudit.create({ data: { participationId: current.id, campaignId: current.campaignId, sellerId: current.sellerId, sellerOfferId: current.sellerOfferId, actorUserId, actorRole: actor.role, action: "PARTICIPATION_CANCELLED", previousStatus: "REQUESTED", newStatus: "CANCELLED", expectedVersion: input.expectedVersion, previousVersion: current.version, newVersion: current.version + 1, reason: input.reason || null } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (serial(error)) throw new CampaignParticipationError("CONCURRENT_CHANGE"); throw error; }
}

export async function decideCampaignParticipation(actorUserId: string, participationId: string, payload: unknown, client: Host = prisma) {
  const input = parse(decisionSchema, payload);
  if (input.decision === "REJECT" && (!input.reason || input.reason.length < 3)) throw new CampaignParticipationError("INVALID_INPUT");
  if (input.decision === "APPROVE" && !input.expectedCampaignVersion) throw new CampaignParticipationError("INVALID_INPUT");
  try { return await client.$transaction(async tx => {
    const actorRole = await adminActor(tx, actorUserId);
    await tx.$queryRaw`SELECT "id" FROM "CampaignParticipation" WHERE "id" = ${participationId} FOR UPDATE`;
    const current = await tx.campaignParticipation.findUnique({ where: { id: participationId } });
    if (!current) throw new CampaignParticipationError("PARTICIPATION_NOT_FOUND");
    if (current.status !== "REQUESTED") throw new CampaignParticipationError("TERMINAL_PARTICIPATION");
    if (current.version !== input.expectedVersion) throw new CampaignParticipationError("STALE_VERSION");
    const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    if (input.decision === "APPROVE") {
      const campaign = await tx.campaign.findUnique({ where: { id: current.campaignId } });
      if (!campaign || campaign.status !== "PUBLISHED" || campaign.effectiveUntil <= new Date()) throw new CampaignParticipationError("CAMPAIGN_NOT_OPEN");
      if (campaign.version !== input.expectedCampaignVersion) throw new CampaignParticipationError("STALE_VERSION");
      const campaignChanged = await tx.campaign.updateMany({ where: { id: campaign.id, version: input.expectedCampaignVersion, status: "PUBLISHED" }, data: { version: { increment: 1 } } });
      if (campaignChanged.count !== 1) throw new CampaignParticipationError("STALE_VERSION");
      await tx.campaignSellerOfferTarget.create({ data: { campaignId: campaign.id, sellerOfferId: current.sellerOfferId } });
      const after = await tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      await tx.campaignAudit.create({ data: { campaignId: campaign.id, actorUserId, sellerOfferId: current.sellerOfferId, actorRole, action: "CAMPAIGN_TARGET_ADDED", previousVersion: campaign.version, newVersion: after.version, previousState: { ...campaignEvidence(campaign), targetChange: { scope: "SELLER_OFFER", sellerOfferId: current.sellerOfferId, targeted: false } }, newState: { ...campaignEvidence(after), targetChange: { scope: "SELLER_OFFER", sellerOfferId: current.sellerOfferId, targeted: true } }, reason: input.reason || "Participation approved" } });
    }
    const changed = await tx.campaignParticipation.updateMany({ where: { id: current.id, status: "REQUESTED", version: input.expectedVersion }, data: { status: nextStatus, activeKey: nextStatus === "APPROVED" ? current.activeKey : null, decisionReason: input.reason || null, decidedAt: new Date(), version: { increment: 1 } } });
    if (changed.count !== 1) throw new CampaignParticipationError("STALE_VERSION");
    await tx.campaignParticipationAudit.create({ data: { participationId: current.id, campaignId: current.campaignId, sellerId: current.sellerId, sellerOfferId: current.sellerOfferId, actorUserId, actorRole, action: nextStatus === "APPROVED" ? "PARTICIPATION_APPROVED" : "PARTICIPATION_REJECTED", previousStatus: "REQUESTED", newStatus: nextStatus, expectedVersion: input.expectedVersion, previousVersion: current.version, newVersion: current.version + 1, reason: input.reason || null } });
    return tx.campaignParticipation.findUniqueOrThrow({ where: { id: current.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (serial(error)) throw new CampaignParticipationError("CONCURRENT_CHANGE"); throw error; }
}

export async function revokeCampaignParticipation(actorUserId: string, participationId: string, payload: unknown, client: Host = prisma) {
  const input = parse(revokeSchema, payload);
  try { return await client.$transaction(async tx => {
    const actorRole = await adminActor(tx, actorUserId);
    await tx.$queryRaw`SELECT "id" FROM "CampaignParticipation" WHERE "id" = ${participationId} FOR UPDATE`;
    const current = await tx.campaignParticipation.findUnique({ where: { id: participationId } });
    if (!current) throw new CampaignParticipationError("PARTICIPATION_NOT_FOUND");
    if (current.status !== "APPROVED") throw new CampaignParticipationError("TERMINAL_PARTICIPATION");
    if (current.version !== input.expectedVersion) throw new CampaignParticipationError("STALE_VERSION");
    const campaign = await tx.campaign.findUnique({ where: { id: current.campaignId } });
    if (!campaign || campaign.version !== input.expectedCampaignVersion) throw new CampaignParticipationError("STALE_VERSION");
    const target = await tx.campaignSellerOfferTarget.findUnique({ where: { campaignId_sellerOfferId: { campaignId: current.campaignId, sellerOfferId: current.sellerOfferId } } });
    if (!target) throw new CampaignParticipationError("TARGET_MISMATCH");
    const campaignChanged = await tx.campaign.updateMany({ where: { id: campaign.id, version: input.expectedCampaignVersion }, data: { version: { increment: 1 } } });
    if (campaignChanged.count !== 1) throw new CampaignParticipationError("STALE_VERSION");
    await tx.campaignSellerOfferTarget.delete({ where: { id: target.id } });
    const after = await tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    await tx.campaignAudit.create({ data: { campaignId: campaign.id, actorUserId, sellerOfferId: current.sellerOfferId, actorRole, action: "CAMPAIGN_TARGET_REMOVED", previousVersion: campaign.version, newVersion: after.version, previousState: { ...campaignEvidence(campaign), targetChange: { scope: "SELLER_OFFER", sellerOfferId: current.sellerOfferId, targeted: true } }, newState: { ...campaignEvidence(after), targetChange: { scope: "SELLER_OFFER", sellerOfferId: current.sellerOfferId, targeted: false } }, reason: input.reason } });
    const changed = await tx.campaignParticipation.updateMany({ where: { id: current.id, status: "APPROVED", version: input.expectedVersion }, data: { status: "REVOKED", activeKey: null, decisionReason: input.reason, decidedAt: new Date(), version: { increment: 1 } } });
    if (changed.count !== 1) throw new CampaignParticipationError("STALE_VERSION");
    await tx.campaignParticipationAudit.create({ data: { participationId: current.id, campaignId: current.campaignId, sellerId: current.sellerId, sellerOfferId: current.sellerOfferId, actorUserId, actorRole, action: "PARTICIPATION_REVOKED", previousStatus: "APPROVED", newStatus: "REVOKED", expectedVersion: input.expectedVersion, previousVersion: current.version, newVersion: current.version + 1, reason: input.reason } });
    return tx.campaignParticipation.findUniqueOrThrow({ where: { id: current.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (serial(error)) throw new CampaignParticipationError("CONCURRENT_CHANGE"); throw error; }
}

export async function listOwnCampaignParticipations(actorUserId: string, client: Host = prisma) { return client.$transaction(async tx => { const actor = await sellerActor(tx, actorUserId); return tx.campaignParticipation.findMany({ where: { sellerId: actor.sellerId }, select: sellerSelect, orderBy: { createdAt: "desc" }, take: 100 }); }); }
export async function listAdminCampaignParticipations(actorUserId: string, status: unknown, client: Host = prisma) { return client.$transaction(async tx => { await adminActor(tx, actorUserId); const parsed = z.enum(["REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "REVOKED"]).optional().safeParse(status || undefined); if (!parsed.success) throw new CampaignParticipationError("INVALID_INPUT"); return tx.campaignParticipation.findMany({ where: parsed.data ? { status: parsed.data } : {}, orderBy: { createdAt: "desc" }, take: 100, include: { campaign: true, sellerOffer: { include: { catalogProduct: true } }, seller: { select: { id: true, storeName: true } } } }); }); }
