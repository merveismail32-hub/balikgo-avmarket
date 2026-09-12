import "server-only";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { eligibleOfferPolicy, isOfferEligible } from "./catalog-data";
import { calculateCampaignCandidate, selectCampaignWinner } from "./campaign-domain";

type Client = Pick<PrismaClient, "sellerOffer">;
export async function resolveSellerOfferCampaigns(sellerOfferIds: readonly string[], effectiveAt: Date, client: Client = prisma, campaignId?: string) {
  const ids = [...new Set(sellerOfferIds)];
  if (ids.length === 0) return new Map<string, ReturnType<typeof selectCampaignWinner>>();
  if (ids.length > 50 || !Number.isFinite(effectiveAt.getTime())) throw new Error("INVALID_CAMPAIGN_RESOLUTION_INPUT");
  const offers = await client.sellerOffer.findMany({
    where: { id: { in: ids }, ...eligibleOfferPolicy, price: { gt: 0 } },
    select: { id: true, price: true, active: true, stock: true, priceAnomalyHeld: true, seller: { select: { status: true } }, catalogProduct: { select: { active: true, moderationStatus: true } }, campaignTargets: { where: { campaign: { status: "PUBLISHED", effectiveFrom: { lte: effectiveAt }, effectiveUntil: { gt: effectiveAt } } }, select: { campaign: { select: { id: true, version: true, status: true, campaignType: true, percentage: true, fixedAmount: true, fixedPrice: true, effectiveFrom: true, effectiveUntil: true } } } } },
  });
  const result = new Map<string, ReturnType<typeof selectCampaignWinner>>(ids.map(id => [id, null]));
  for (const offer of offers) if (isOfferEligible(offer)) result.set(offer.id, selectCampaignWinner(offer.campaignTargets.filter(target => !campaignId || target.campaign.id === campaignId).map(target => calculateCampaignCandidate(offer.id, offer.price, target.campaign, effectiveAt))));
  return result;
}

export async function resolveSellerOfferCampaign(sellerOfferId: string, effectiveAt: Date, client: Client = prisma) {
  return (await resolveSellerOfferCampaigns([sellerOfferId], effectiveAt, client)).get(sellerOfferId) ?? null;
}
