import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { createCampaign, publishCampaign, updateCampaign, cancelCampaign } from "../app/lib/campaign";
import { addCampaignSellerOfferTarget, removeCampaignSellerOfferTarget } from "../app/lib/campaign-target";
import { resolveSellerOfferCampaign } from "../app/lib/campaign-resolution";
import { CampaignError } from "../app/lib/campaign-domain";
import { createSellerOfferWithPriceEvidence } from "../app/lib/seller-offer-price";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const token = crypto.randomUUID(), prefix = `qa-campaign-c-${token}`;
const ids = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], products: [] as string[], offers: [] as string[], campaigns: [] as string[] };
const at = new Date("2035-06-15T12:00:00.000Z"), from = new Date("2035-06-15T11:00:00.000Z"), until = new Date("2035-06-15T13:00:00.000Z");
const reason = "Slice C verification";
const hasCode = (value: string) => (error: unknown) => error instanceof CampaignError && error.code === value;
async function cleanup() {
  if (ids.campaigns.length) { await db.campaignAudit.deleteMany({ where: { campaignId: { in: ids.campaigns } } }); await db.campaignSellerOfferTarget.deleteMany({ where: { campaignId: { in: ids.campaigns } } }); await db.campaign.deleteMany({ where: { id: { in: ids.campaigns } } }); }
  if (ids.offers.length) { await db.sellerOfferPriceObservation.deleteMany({ where: { sellerOfferId: { in: ids.offers } } }); await db.sellerOffer.deleteMany({ where: { id: { in: ids.offers } } }); }
  if (ids.products.length) await db.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.catalogs.length) await db.catalogProduct.deleteMany({ where: { id: { in: ids.catalogs } } });
  if (ids.users.length) await db.user.deleteMany({ where: { id: { in: ids.users } } });
}
async function makeUser(role: "ADMIN" | "SELLER" | "CUSTOMER", suffix: string) { const user = await db.user.create({ data: { name: "QA", surname: suffix, role, email: `${prefix}-${suffix}@invalid.local`, phone: "0", passwordHash: "test-only" } }); ids.users.push(user.id); return user; }
async function makeOffer(index: number, options: { active?: boolean; stock?: number; held?: boolean; sellerApproved?: boolean; catalogActive?: boolean } = {}) {
  const sellerUser = await makeUser("SELLER", `seller-${index}`);
  const seller = await db.sellerProfile.create({ data: { userId: sellerUser.id, storeName: `${prefix}-${index}`, companyType: "QA", taxNumber: token.replaceAll("-", "").slice(index, index + 10), taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: options.sellerApproved === false ? "PENDING" : "APPROVED" } }); ids.sellers.push(seller.id);
  const catalog = await db.catalogProduct.create({ data: { slug: `${prefix}-c-${index}`, identityKey: `${prefix}-c-${index}`, name: "QA", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa", active: options.catalogActive !== false, moderationStatus: "APPROVED" } }); ids.catalogs.push(catalog.id);
  const product = await db.product.create({ data: { sellerId: seller.id, catalogProductId: catalog.id, name: "QA", slug: `${prefix}-p-${index}`, category: "QA", brand: "QA", price: "1000", stock: options.stock ?? 5, description: "QA", imageUrl: "/qa", active: options.active !== false, moderationStatus: "APPROVED" } }); ids.products.push(product.id);
  const offer = await db.$transaction(tx => createSellerOfferWithPriceEvidence(tx, { data: { sellerId: seller.id, catalogProductId: catalog.id, legacyProductId: product.id, price: "1000", stock: options.stock ?? 5, active: options.active !== false }, source: "SELLER_PRODUCT_CREATE", actorUserId: sellerUser.id })); ids.offers.push(offer.id);
  if (options.held) await db.sellerOffer.update({ where: { id: offer.id }, data: { priceAnomalyHeld: true } });
  return offer;
}
async function makeCampaign(adminId: string, suffix: string, campaignType: "PERCENTAGE_DISCOUNT" | "FIXED_AMOUNT_DISCOUNT" | "FIXED_PROMOTIONAL_PRICE", value: string, window = { from, until }) {
  const fields = campaignType === "PERCENTAGE_DISCOUNT" ? { percentage: value } : campaignType === "FIXED_AMOUNT_DISCOUNT" ? { fixedAmount: value } : { fixedPrice: value };
  const result = await createCampaign(adminId, { internalName: `${prefix}-${suffix}`, campaignType, ...fields, effectiveFrom: window.from.toISOString(), effectiveUntil: window.until.toISOString(), reason }, db); ids.campaigns.push(result.campaign.id); return result.campaign;
}
async function boundary() { return { offers: await db.sellerOffer.findMany({ where: { id: { in: ids.offers } }, orderBy: { id: "asc" }, select: { id: true, price: true, priceVersion: true, priceAnomalyHeld: true } }), observations: await db.sellerOfferPriceObservation.count(), interventions: await db.adminPriceIntervention.count(), coupons: await db.coupon.findMany({ orderBy: { id: "asc" } }), redemptions: await db.couponRedemption.findMany({ orderBy: { id: "asc" } }) }; }

async function main() {
  const admin1 = await makeUser("ADMIN", "admin-1"), admin2 = await makeUser("ADMIN", "admin-2"), customer = await makeUser("CUSTOMER", "customer");
  const good = await makeOffer(1), wrong = await makeOffer(2), held = await makeOffer(3, { held: true }), inactive = await makeOffer(4, { active: false }), empty = await makeOffer(5, { stock: 0 }), pending = await makeOffer(6, { sellerApproved: false }), catalogOff = await makeOffer(7, { catalogActive: false });
  const before = await boundary();
  const draft = await makeCampaign(admin1.id, "draft", "PERCENTAGE_DISCOUNT", "10");
  for (const actor of [customer.id, ids.users.find(id => id !== admin1.id && id !== admin2.id && id !== customer.id)!]) await assert.rejects(addCampaignSellerOfferTarget(actor, draft.id, { sellerOfferId: good.id, expectedVersion: 1, reason }, db), hasCode("FORBIDDEN"));
  await assert.rejects(addCampaignSellerOfferTarget(admin1.id, draft.id, { sellerOfferId: "missing", expectedVersion: 1, reason }, db), hasCode("OFFER_NOT_FOUND"));
  const add = await addCampaignSellerOfferTarget(admin1.id, draft.id, { sellerOfferId: good.id, expectedVersion: 1, reason }, db); assert.equal(add.campaign.version, 2);
  const auditCountBeforeReplay = await db.campaignAudit.count({ where: { campaignId: draft.id } });
  const duplicate = await addCampaignSellerOfferTarget(admin1.id, draft.id, { sellerOfferId: good.id, expectedVersion: 2, reason }, db); assert.equal(duplicate.changed, false); assert.equal(duplicate.campaign.version, 2); assert.equal(await db.campaignAudit.count({ where: { campaignId: draft.id } }), auditCountBeforeReplay);
  await assert.rejects(addCampaignSellerOfferTarget(admin1.id, draft.id, { sellerOfferId: wrong.id, expectedVersion: 1, reason }, db), hasCode("STALE_VERSION"));
  assert.equal(await resolveSellerOfferCampaign(good.id, at, db), null);
  await publishCampaign(admin1.id, draft.id, { expectedVersion: 2, reason }, db);
  assert.equal((await resolveSellerOfferCampaign(good.id, at, db))!.effectiveAmount, "900.00");
  assert.equal(await resolveSellerOfferCampaign(wrong.id, at, db), null);
  assert.equal((await resolveSellerOfferCampaign(good.id, from, db))!.effectiveAmount, "900.00");
  assert.equal(await resolveSellerOfferCampaign(good.id, until, db), null);
  const upcoming = await makeCampaign(admin1.id, "upcoming", "FIXED_AMOUNT_DISCOUNT", "300", { from: new Date(at.getTime() + 1), until });
  await addCampaignSellerOfferTarget(admin1.id, upcoming.id, { sellerOfferId: good.id, expectedVersion: 1, reason }, db); await publishCampaign(admin1.id, upcoming.id, { expectedVersion: 2, reason }, db); assert.equal((await resolveSellerOfferCampaign(good.id, at, db))!.campaignId, draft.id);
  const fixed = await makeCampaign(admin1.id, "fixed", "FIXED_AMOUNT_DISCOUNT", "150"); await addCampaignSellerOfferTarget(admin1.id, fixed.id, { sellerOfferId: good.id, expectedVersion: 1, reason }, db); await publishCampaign(admin1.id, fixed.id, { expectedVersion: 2, reason }, db);
  const promo = await makeCampaign(admin1.id, "promo", "FIXED_PROMOTIONAL_PRICE", "875"); await addCampaignSellerOfferTarget(admin1.id, promo.id, { sellerOfferId: good.id, expectedVersion: 1, reason }, db); await publishCampaign(admin1.id, promo.id, { expectedVersion: 2, reason }, db); await addCampaignSellerOfferTarget(admin1.id, promo.id, { sellerOfferId: wrong.id, expectedVersion: 3, reason }, db); assert.equal((await resolveSellerOfferCampaign(wrong.id, at, db))!.effectiveAmount, "875.00"); await removeCampaignSellerOfferTarget(admin1.id, promo.id, { sellerOfferId: wrong.id, expectedVersion: 4, reason }, db);
  assert.equal((await resolveSellerOfferCampaign(good.id, at, db))!.campaignId, fixed.id);
  const tie = await makeCampaign(admin1.id, "tie", "FIXED_PROMOTIONAL_PRICE", "850"); await addCampaignSellerOfferTarget(admin1.id, tie.id, { sellerOfferId: good.id, expectedVersion: 1, reason }, db); await publishCampaign(admin1.id, tie.id, { expectedVersion: 2, reason }, db);
  assert.equal((await resolveSellerOfferCampaign(good.id, at, db))!.campaignId, [fixed.id, tie.id].sort()[0]);
  const nonBenefit = await makeCampaign(admin1.id, "non-benefit", "FIXED_PROMOTIONAL_PRICE", "1000"); await addCampaignSellerOfferTarget(admin1.id, nonBenefit.id, { sellerOfferId: wrong.id, expectedVersion: 1, reason }, db); await publishCampaign(admin1.id, nonBenefit.id, { expectedVersion: 2, reason }, db); assert.equal(await resolveSellerOfferCampaign(wrong.id, at, db), null);
  for (const offer of [held, inactive, empty, pending, catalogOff]) { await addCampaignSellerOfferTarget(admin1.id, draft.id, { sellerOfferId: offer.id, expectedVersion: (await db.campaign.findUniqueOrThrow({ where: { id: draft.id } })).version, reason }, db); assert.equal(await resolveSellerOfferCampaign(offer.id, at, db), null); }
  const current = await db.campaign.findUniqueOrThrow({ where: { id: draft.id } });
  const race = await Promise.allSettled([admin1.id, admin2.id].map((actor, i) => removeCampaignSellerOfferTarget(actor, draft.id, { sellerOfferId: i ? inactive.id : held.id, expectedVersion: current.version, reason }, db))); assert.equal(race.filter(x => x.status === "fulfilled").length, 1); assert(race.some(x => x.status === "rejected" && hasCode("STALE_VERSION")(x.reason)));
  const version = (await db.campaign.findUniqueOrThrow({ where: { id: draft.id } })).version;
  const updatePayload = { internalName: `${prefix}-race-update`, campaignType: "PERCENTAGE_DISCOUNT" as const, percentage: "10", effectiveFrom: from.toISOString(), effectiveUntil: until.toISOString(), expectedVersion: version, reason };
  const crossRace = await Promise.allSettled([updateCampaign(admin1.id, draft.id, updatePayload, db), removeCampaignSellerOfferTarget(admin2.id, draft.id, { sellerOfferId: good.id, expectedVersion: version, reason }, db)]); assert.equal(crossRace.filter(x => x.status === "fulfilled").length, 1); assert(crossRace.some(x => x.status === "rejected" && hasCode("STALE_VERSION")(x.reason)));
  if (await db.campaignSellerOfferTarget.count({ where: { campaignId: draft.id, sellerOfferId: good.id } })) { const v = (await db.campaign.findUniqueOrThrow({ where: { id: draft.id } })).version; const removed = await removeCampaignSellerOfferTarget(admin1.id, draft.id, { sellerOfferId: good.id, expectedVersion: v, reason }, db); assert.equal(removed.campaign.version, v + 1); assert.equal(await db.campaignSellerOfferTarget.count({ where: { campaignId: draft.id, sellerOfferId: good.id } }), 0); assert.notEqual((await resolveSellerOfferCampaign(good.id, at, db))?.campaignId, draft.id); }
  const audits = await db.campaignAudit.findMany({ where: { campaignId: draft.id }, orderBy: { newVersion: "asc" } }); assert(audits.some(x => x.action === "CAMPAIGN_TARGET_ADDED" && x.sellerOfferId === good.id)); assert(audits.some(x => x.action === "CAMPAIGN_TARGET_REMOVED" && x.sellerOfferId)); assert(audits.every((x, i) => i === 0 || x.newVersion === x.previousVersion! + 1));
  const rollbackCampaign = await makeCampaign(admin1.id, "audit-rollback", "PERCENTAGE_DISCOUNT", "5"); const failing = db.$extends({ query: { campaignAudit: { async create() { throw new Error("QA_TARGET_AUDIT_FAILURE"); } } } }); await assert.rejects(addCampaignSellerOfferTarget(admin1.id, rollbackCampaign.id, { sellerOfferId: wrong.id, expectedVersion: 1, reason }, failing as unknown as typeof db), /QA_TARGET_AUDIT_FAILURE/); assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: rollbackCampaign.id } })).version, 1); assert.equal(await db.campaignSellerOfferTarget.count({ where: { campaignId: rollbackCampaign.id } }), 0); assert.equal(await db.campaignAudit.count({ where: { campaignId: rollbackCampaign.id } }), 1);
  const cancelCandidate = await makeCampaign(admin1.id, "cancel", "PERCENTAGE_DISCOUNT", "50"); await addCampaignSellerOfferTarget(admin1.id, cancelCandidate.id, { sellerOfferId: wrong.id, expectedVersion: 1, reason }, db); await publishCampaign(admin1.id, cancelCandidate.id, { expectedVersion: 2, reason }, db); await cancelCampaign(admin1.id, cancelCandidate.id, { expectedVersion: 3, reason }, db); assert.equal(await resolveSellerOfferCampaign(wrong.id, at, db), null);
  assert.deepEqual(await boundary(), before);
  console.log("PASS: Slice C guarded TEST DB target auth/integrity/idempotency/CAS/audit/concurrency, eligibility, temporal/overlap/tie, no economic side effects");
}

cleanup().then(main).finally(async () => { await cleanup(); assert.equal(await db.campaign.count({ where: { id: { in: ids.campaigns } } }), 0); assert.equal(await db.user.count({ where: { id: { in: ids.users } } }), 0); console.log("PASS: cleanup"); await db.$disconnect(); });
