import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { CampaignError, campaignEvidence, campaignTransitionSchema, createCampaignSchema, normalizeCampaign, parseCampaignInput, updateCampaignSchema } from "./campaign-domain";

type Client = Pick<PrismaClient, "$transaction">;
type Operation = "create" | "update" | "publish" | "cancel";
async function mutate(operation: Operation, actorUserId: string, campaignId: string | null, payload: unknown, client: Client) {
  const parsed = operation === "create" ? parseCampaignInput(createCampaignSchema, payload) : operation === "update" ? parseCampaignInput(updateCampaignSchema, payload) : parseCampaignInput(campaignTransitionSchema, payload);
  try {
    return await client.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
      if (actor?.role !== "ADMIN") throw new CampaignError("FORBIDDEN");
      const now = new Date();
      if (operation === "create") {
        const { reason, ...configuration } = parseCampaignInput(createCampaignSchema, payload);
        const campaign = await tx.campaign.create({ data: { ...normalizeCampaign(configuration, now), createdByUserId: actorUserId } });
        await tx.campaignAudit.create({ data: { campaignId: campaign.id, actorUserId, actorRole: "ADMIN", action: "CAMPAIGN_CREATED", newVersion: 1, newState: campaignEvidence(campaign), reason } });
        return { changed: true, campaign: campaignEvidence(campaign) };
      }
      const { expectedVersion, reason } = parsed as { expectedVersion: number; reason: string };
      const before = await tx.campaign.findUnique({ where: { id: campaignId! } });
      if (!before) throw new CampaignError("NOT_FOUND");
      if (before.version !== expectedVersion) throw new CampaignError("STALE_VERSION");
      if (before.status === "CANCELLED") throw new CampaignError("INVALID_TRANSITION");
      let data: Prisma.CampaignUpdateManyMutationInput;
      if (operation === "update") {
        const { expectedVersion: _version, reason: _reason, ...configuration } = parseCampaignInput(updateCampaignSchema, payload);
        void _version; void _reason;
        const normalized = normalizeCampaign(configuration, now);
        if (JSON.stringify(campaignEvidence(before)) === JSON.stringify(campaignEvidence({ ...before, ...normalized }))) return { changed: false, campaign: campaignEvidence(before) };
        data = normalized;
      } else if (operation === "publish") {
        if (before.status !== "DRAFT") throw new CampaignError("INVALID_TRANSITION");
        const evidence = campaignEvidence(before);
        normalizeCampaign({ internalName: evidence.internalName, campaignType: evidence.campaignType, percentage: evidence.percentage, fixedAmount: evidence.fixedAmount, fixedPrice: evidence.fixedPrice, effectiveFrom: evidence.effectiveFrom, effectiveUntil: evidence.effectiveUntil }, now);
        data = { status: "PUBLISHED" };
      } else data = { status: "CANCELLED" };
      const result = await tx.campaign.updateMany({ where: { id: before.id, version: expectedVersion, status: before.status }, data: { ...data, version: { increment: 1 } } });
      if (result.count !== 1) throw new CampaignError("STALE_VERSION");
      const after = await tx.campaign.findUniqueOrThrow({ where: { id: before.id } });
      await tx.campaignAudit.create({ data: { campaignId: before.id, actorUserId, actorRole: "ADMIN", action: operation === "update" ? "CAMPAIGN_UPDATED" : operation === "publish" ? "CAMPAIGN_PUBLISHED" : "CAMPAIGN_CANCELLED", previousVersion: before.version, newVersion: after.version, previousState: campaignEvidence(before), newState: campaignEvidence(after), reason } });
      return { changed: true, campaign: campaignEvidence(after) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if ((error as { code?: string }).code === "P2034") throw new CampaignError("STALE_VERSION");
    throw error;
  }
}
// Actor identity is supplied by the authenticated server boundary, never the DTO.
export const createCampaign = (actor: string, payload: unknown, client: Client = prisma) => mutate("create", actor, null, payload, client);
export const updateCampaign = (actor: string, id: string, payload: unknown, client: Client = prisma) => mutate("update", actor, id, payload, client);
export const publishCampaign = (actor: string, id: string, payload: unknown, client: Client = prisma) => mutate("publish", actor, id, payload, client);
export const cancelCampaign = (actor: string, id: string, payload: unknown, client: Client = prisma) => mutate("cancel", actor, id, payload, client);
