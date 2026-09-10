import { auth } from "@/auth";
import { CampaignError } from "@/app/lib/campaign-domain";
export async function campaignAdminRequest(request: Request, mutation: (actor: string, body: unknown) => Promise<unknown>) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    return Response.json(await mutation(session.user.id, await request.json().catch(() => null)));
  } catch (error) {
    if (error instanceof CampaignError) return Response.json({ error: error.code }, { status: error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "OFFER_NOT_FOUND" || error.code === "TARGET_NOT_FOUND" ? 404 : error.code === "STALE_VERSION" ? 409 : 400 });
    throw error;
  }
}
