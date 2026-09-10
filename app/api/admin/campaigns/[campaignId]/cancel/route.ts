import { cancelCampaign } from "@/app/lib/campaign";
import { campaignAdminRequest } from "../../handler";
export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  return campaignAdminRequest(request, (actor, body) => cancelCampaign(actor, campaignId, body));
}
