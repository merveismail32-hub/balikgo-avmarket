import { addCampaignSellerOfferTarget, removeCampaignSellerOfferTarget } from "@/app/lib/campaign-target";
import { campaignAdminRequest } from "../../handler";

export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  return campaignAdminRequest(request, (actor, body) => addCampaignSellerOfferTarget(actor, campaignId, body));
}

export async function DELETE(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  return campaignAdminRequest(request, (actor, body) => removeCampaignSellerOfferTarget(actor, campaignId, body));
}
