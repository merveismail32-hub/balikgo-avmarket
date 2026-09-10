import { updateCampaign } from "@/app/lib/campaign";
import { campaignAdminRequest } from "../handler";
export async function PATCH(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  return campaignAdminRequest(request, (actor, body) => updateCampaign(actor, campaignId, body));
}
