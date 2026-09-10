import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { createCampaign, updateCampaign, publishCampaign, cancelCampaign } from "../app/lib/campaign";
import { CampaignError } from "../app/lib/campaign-domain";
const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const users: string[] = [], campaigns: string[] = [];
const prefix = `qa-campaign-${crypto.randomUUID()}`;
const config = { internalName: prefix, campaignType: "PERCENTAGE_DISCOUNT", percentage: "20.50", effectiveFrom: new Date(Date.now() - 60000).toISOString(), effectiveUntil: new Date(Date.now() + 86400000).toISOString(), reason: "Campaign verification" };
const code = (value: string) => (e: unknown) => e instanceof CampaignError && e.code === value;
async function boundary() {
  return { offers: await db.sellerOffer.findMany({ orderBy: { id: "asc" }, select: { id: true, price: true, priceVersion: true, priceAnomalyHeld: true } }), observations: await db.sellerOfferPriceObservation.count(), coupons: await db.coupon.findMany({ orderBy: { id: "asc" } }), redemptions: await db.couponRedemption.findMany({ orderBy: { id: "asc" } }) };
}
async function main() {
  for (const role of ["ADMIN", "ADMIN", "SELLER", "CUSTOMER"] as const) {
    const user = await db.user.create({ data: { name: "QA", surname: role, role, email: `${prefix}-${users.length}@invalid.local`, phone: "0", passwordHash: "test-only" } }); users.push(user.id);
  }
  const before = await boundary();
  for (const actor of users.slice(2)) await assert.rejects(createCampaign(actor, config, db), code("FORBIDDEN"));
  const created = await createCampaign(users[0], config, db); const id = created.campaign.id; campaigns.push(id);
  assert.equal(created.campaign.status, "DRAFT"); assert.equal(created.campaign.version, 1);
  const update = (version: number, internalName = prefix) => ({ ...config, internalName, expectedVersion: version });
  assert.equal((await updateCampaign(users[0], id, update(1), db)).changed, false);
  assert.equal((await updateCampaign(users[0], id, update(1, `${prefix}-updated`), db)).campaign.version, 2);
  await assert.rejects(updateCampaign(users[0], id, update(1), db), code("STALE_VERSION"));
  await assert.rejects(publishCampaign(users[0], id, { expectedVersion: 1, reason: config.reason }, db), code("STALE_VERSION"));
  for (const actor of users.slice(2)) {
    await assert.rejects(updateCampaign(actor, id, update(2), db), code("FORBIDDEN"));
    await assert.rejects(publishCampaign(actor, id, { expectedVersion: 2, reason: config.reason }, db), code("FORBIDDEN"));
    await assert.rejects(cancelCampaign(actor, id, { expectedVersion: 2, reason: config.reason }, db), code("FORBIDDEN"));
  }
  assert.equal((await publishCampaign(users[0], id, { expectedVersion: 2, reason: config.reason }, db)).campaign.status, "PUBLISHED");
  const race = await Promise.allSettled(users.slice(0, 2).map((actor, i) => updateCampaign(actor, id, update(3, `${prefix}-race-${i}`), db)));
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert(race.some(r => r.status === "rejected" && code("STALE_VERSION")(r.reason)));
  const audits = await db.campaignAudit.findMany({ where: { campaignId: id }, orderBy: { newVersion: "asc" } });
  assert.deepEqual(audits.map(a => a.newVersion), [1, 2, 3, 4]);
  assert(audits.every(a => a.actorRole === "ADMIN" && a.reason === config.reason));
  assert.equal((audits[1].previousState as { version: number }).version, 1);
  // Force an audit failure inside a real interactive transaction; the preceding UPDATE must roll back.
  const failing = db.$extends({ query: { campaignAudit: { async create() { throw new Error("QA_AUDIT_FAILURE"); } } } });
  const snapshot = await db.campaign.findUniqueOrThrow({ where: { id } });
  await assert.rejects(updateCampaign(users[0], id, update(4, `${prefix}-rollback`), failing as unknown as typeof db), /QA_AUDIT_FAILURE/);
  assert.deepEqual(await db.campaign.findUniqueOrThrow({ where: { id } }), snapshot);
  assert.equal(await db.campaignAudit.count({ where: { campaignId: id } }), 4);
  assert.equal((await cancelCampaign(users[0], id, { expectedVersion: 4, reason: config.reason }, db)).campaign.status, "CANCELLED");
  for (const operation of [publishCampaign, cancelCampaign]) await assert.rejects(operation(users[0], id, { expectedVersion: 5, reason: config.reason }, db), code("INVALID_TRANSITION"));
  await assert.rejects(updateCampaign(users[0], id, update(5), db), code("INVALID_TRANSITION"));
  const draft = await createCampaign(users[0], config, db); campaigns.push(draft.campaign.id);
  await cancelCampaign(users[0], draft.campaign.id, { expectedVersion: 1, reason: config.reason }, db);
  await assert.rejects(db.campaign.update({ where: { id }, data: { version: 0 } }));
  await assert.rejects(db.campaign.update({ where: { id }, data: { fixedAmount: new Prisma.Decimal(1) } }));
  assert.deepEqual(await boundary(), before);
  console.log("PASS: guarded TEST DB create/auth/update/no-op/stale/publish/cancel/terminal/concurrency/audit/rollback/constraints/#25/coupon separation");
}
main().finally(async () => {
  await db.campaignAudit.deleteMany({ where: { campaignId: { in: campaigns } } });
  await db.campaign.deleteMany({ where: { id: { in: campaigns } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  assert.equal(await db.campaign.count({ where: { id: { in: campaigns } } }), 0);
  assert.equal(await db.user.count({ where: { id: { in: users } } }), 0);
  console.log("PASS: cleanup"); await db.$disconnect();
});
