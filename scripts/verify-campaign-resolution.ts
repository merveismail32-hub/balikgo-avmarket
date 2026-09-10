import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { calculateCampaignCandidate, selectCampaignWinner, type CampaignRuleInput } from "../app/lib/campaign-domain";

const at = new Date("2030-06-15T12:00:00.000Z");
const base = { id: "campaign-b", version: 7, status: "PUBLISHED", effectiveFrom: new Date("2030-06-15T11:00:00.000Z"), effectiveUntil: new Date("2030-06-15T13:00:00.000Z"), percentage: null, fixedAmount: null, fixedPrice: null } as const;
function rule(value: Partial<CampaignRuleInput>): CampaignRuleInput { return { ...base, campaignType: "PERCENTAGE_DISCOUNT", ...value }; }

const candidate = (campaign: CampaignRuleInput, basePrice = "1000") => calculateCampaignCandidate("offer-1", basePrice, campaign, at);
const percentage = candidate(rule({ percentage: new Prisma.Decimal("10") }))!;
assert.deepEqual({ effective: percentage.effectiveAmount, discount: percentage.discountAmount }, { effective: "900.00", discount: "100.00" });
assert.equal(candidate(rule({ percentage: new Prisma.Decimal("50") }), "10.05")!.effectiveAmount, "5.03");
const fixed = candidate(rule({ campaignType: "FIXED_AMOUNT_DISCOUNT", fixedAmount: new Prisma.Decimal("150") }))!;
assert.equal(fixed.effectiveAmount, "850.00");
const promotional = candidate(rule({ campaignType: "FIXED_PROMOTIONAL_PRICE", fixedPrice: new Prisma.Decimal("875") }))!;
assert.equal(promotional.effectiveAmount, "875.00");
for (const amount of ["1000", "1001"]) assert.equal(candidate(rule({ campaignType: "FIXED_AMOUNT_DISCOUNT", fixedAmount: new Prisma.Decimal(amount) })), null);
for (const amount of ["1000", "1001"]) assert.equal(candidate(rule({ campaignType: "FIXED_PROMOTIONAL_PRICE", fixedPrice: new Prisma.Decimal(amount) })), null);
assert.equal(candidate(rule({ status: "DRAFT", percentage: new Prisma.Decimal(10) })), null);
assert.equal(candidate(rule({ status: "CANCELLED", percentage: new Prisma.Decimal(10) })), null);
assert.equal(candidate(rule({ effectiveFrom: at, effectiveUntil: new Date(at.getTime() + 1), percentage: new Prisma.Decimal(10) }))!.status, "ELIGIBLE");
assert.equal(candidate(rule({ effectiveFrom: new Date(at.getTime() + 1), percentage: new Prisma.Decimal(10) })), null);
assert.equal(candidate(rule({ effectiveUntil: at, percentage: new Prisma.Decimal(10) })), null);
assert.equal(selectCampaignWinner([percentage, promotional, fixed])!.campaignId, fixed.campaignId);
const tieA = candidate(rule({ id: "campaign-a", campaignType: "FIXED_PROMOTIONAL_PRICE", fixedPrice: new Prisma.Decimal(850) }))!;
const tieB = candidate(rule({ id: "campaign-b", campaignType: "FIXED_AMOUNT_DISCOUNT", fixedAmount: new Prisma.Decimal(150) }))!;
assert.equal(selectCampaignWinner([tieB, tieA])!.campaignId, "campaign-a");
assert.equal(selectCampaignWinner([tieA, tieB])!.campaignId, selectCampaignWinner([tieB, tieA])!.campaignId);
assert.equal(selectCampaignWinner([null]), null);
console.log("PASS: Slice C Decimal rules, HALF_UP rounding, fail-closed candidates, temporal boundaries, exclusive lowest-price winner, stable tie and input-order independence");
