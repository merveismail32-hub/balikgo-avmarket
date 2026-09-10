import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { CampaignError, campaignEvidence, campaignTargetSchema, parseCampaignInput } from "./campaign-domain";

type Client = Pick<PrismaClient, "$transaction">;
type Operation = "add" | "remove";
async function mutateTarget(operation: Operation, actorUserId: string, campaignId: string, payload: unknown, client: Client) {
  const input = parseCampaignInput(campaignTargetSchema, payload);
  try {
    return await client.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
      if (actor?.role !== "ADMIN") throw new CampaignError("FORBIDDEN");
      const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) throw new CampaignError("NOT_FOUND");
      if (campaign.version !== input.expectedVersion) throw new CampaignError("STALE_VERSION");
      if (campaign.status === "CANCELLED") throw new CampaignError("INVALID_TRANSITION");
      const offer = await tx.sellerOffer.findUnique({ where: { id: input.sellerOfferId }, select: { id: true, sellerId: true, catalogProductId: true, seller: { select: { id: true } }, catalogProduct: { select: { id: true } } } });
      if (!offer || offer.seller.id !== offer.sellerId || offer.catalogProduct.id !== offer.catalogProductId) throw new CampaignError("OFFER_NOT_FOUND");
      const existing = await tx.campaignSellerOfferTarget.findUnique({ where: { campaignId_sellerOfferId: { campaignId, sellerOfferId: offer.id } } });
      if (operation === "add" && existing) return { changed: false as const, campaign: campaignEvidence(campaign), targetId: existing.id };
      if (operation === "remove" && !existing) throw new CampaignError("TARGET_NOT_FOUND");
      const changed = await tx.campaign.updateMany({ where: { id: campaign.id, version: input.expectedVersion, status: campaign.status }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new CampaignError("STALE_VERSION");
      const target = operation === "add"
        ? await tx.campaignSellerOfferTarget.create({ data: { campaignId, sellerOfferId: offer.id } })
        : (await tx.campaignSellerOfferTarget.delete({ where: { id: existing!.id } }), existing!);
      const after = await tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      const beforeEvidence = { ...campaignEvidence(campaign), targetChange: { scope: "SELLER_OFFER", sellerOfferId: offer.id, targeted: operation === "remove" } };
      const afterEvidence = { ...campaignEvidence(after), targetChange: { scope: "SELLER_OFFER", sellerOfferId: offer.id, targeted: operation === "add" } };
      await tx.campaignAudit.create({ data: { campaignId, actorUserId, sellerOfferId: offer.id, actorRole: "ADMIN", action: operation === "add" ? "CAMPAIGN_TARGET_ADDED" : "CAMPAIGN_TARGET_REMOVED", previousVersion: campaign.version, newVersion: after.version, previousState: beforeEvidence, newState: afterEvidence, reason: input.reason } });
      return { changed: true as const, campaign: campaignEvidence(after), targetId: target.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if ((error as { code?: string }).code === "P2034" || (error as { code?: string }).code === "P2002") throw new CampaignError("STALE_VERSION");
    throw error;
  }
}

export const addCampaignSellerOfferTarget = (actor: string, campaignId: string, payload: unknown, client: Client = prisma) => mutateTarget("add", actor, campaignId, payload, client);
export const removeCampaignSellerOfferTarget = (actor: string, campaignId: string, payload: unknown, client: Client = prisma) => mutateTarget("remove", actor, campaignId, payload, client);
