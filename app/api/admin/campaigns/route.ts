import { createCampaign } from "@/app/lib/campaign";
import { campaignAdminRequest } from "./handler";
export async function POST(request: Request) {
  return campaignAdminRequest(request, (actor, body) => createCampaign(actor, body));
}
