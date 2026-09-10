import { Prisma } from "@prisma/client";
import { z } from "zod";

export class CampaignError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "OFFER_NOT_FOUND" | "TARGET_NOT_FOUND" | "STALE_VERSION" | "INVALID_TRANSITION") { super(code); }
}
const decimal = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
export const campaignConfigurationSchema = z.object({
  internalName: z.string().trim().min(1).max(200),
  campaignType: z.enum(["PERCENTAGE_DISCOUNT", "FIXED_AMOUNT_DISCOUNT", "FIXED_PROMOTIONAL_PRICE"]),
  percentage: decimal.nullable().optional(), fixedAmount: decimal.nullable().optional(), fixedPrice: decimal.nullable().optional(),
  effectiveFrom: z.iso.datetime({ offset: true }), effectiveUntil: z.iso.datetime({ offset: true }),
}).strict();
const reason = z.string().trim().min(3).max(500);
const expectedVersion = z.number().int().positive().max(2147483646);
export const createCampaignSchema = campaignConfigurationSchema.extend({ reason });
export const updateCampaignSchema = campaignConfigurationSchema.extend({ reason, expectedVersion });
export const campaignTransitionSchema = z.object({ reason, expectedVersion }).strict();
export const campaignTargetSchema = z.object({ sellerOfferId: z.string().min(1).max(191), reason, expectedVersion }).strict();
export function parseCampaignInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CampaignError("INVALID_INPUT");
  return result.data;
}
export function normalizeCampaign(value: unknown, now: Date) {
  const input = parseCampaignInput(campaignConfigurationSchema, value);
  const field = { PERCENTAGE_DISCOUNT: "percentage", FIXED_AMOUNT_DISCOUNT: "fixedAmount", FIXED_PROMOTIONAL_PRICE: "fixedPrice" }[input.campaignType];
  const rules: { percentage: Prisma.Decimal | null; fixedAmount: Prisma.Decimal | null; fixedPrice: Prisma.Decimal | null } = { percentage: null, fixedAmount: null, fixedPrice: null };
  for (const key of ["percentage", "fixedAmount", "fixedPrice"] as const) {
    const raw = input[key];
    if (key !== field) { if (raw != null) throw new CampaignError("INVALID_INPUT"); continue; }
    if (raw == null) throw new CampaignError("INVALID_INPUT");
    const amount = new Prisma.Decimal(raw);
    if (!amount.isFinite() || amount.lte(0) || amount.gt("9999999999.99") || (key === "percentage" && amount.gte(100))) throw new CampaignError("INVALID_INPUT");
    rules[key] = amount;
  }
  const effectiveFrom = new Date(input.effectiveFrom), effectiveUntil = new Date(input.effectiveUntil);
  if (!Number.isFinite(now.getTime()) || effectiveFrom >= effectiveUntil || effectiveUntil <= now) throw new CampaignError("INVALID_INPUT");
  return { internalName: input.internalName, campaignType: input.campaignType, ...rules, effectiveFrom, effectiveUntil };
}
export function campaignTemporalState(status: "DRAFT" | "PUBLISHED" | "CANCELLED", from: Date, until: Date, effectiveAt: Date) {
  if (![from, until, effectiveAt].every(d => Number.isFinite(d.getTime())) || from >= until) throw new CampaignError("INVALID_INPUT");
  if (status !== "PUBLISHED") return status;
  return effectiveAt < from ? "UPCOMING" : effectiveAt < until ? "ACTIVE" : "ENDED";
}
type EvidenceSource = ReturnType<typeof normalizeCampaign> & { id: string; version: number; status: "DRAFT" | "PUBLISHED" | "CANCELLED" };
export function campaignEvidence(c: EvidenceSource) {
  return { id: c.id, internalName: c.internalName, status: c.status, campaignType: c.campaignType, percentage: c.percentage?.toFixed(2) ?? null, fixedAmount: c.fixedAmount?.toFixed(2) ?? null, fixedPrice: c.fixedPrice?.toFixed(2) ?? null, effectiveFrom: c.effectiveFrom.toISOString(), effectiveUntil: c.effectiveUntil.toISOString(), version: c.version };
}

export type CampaignRuleInput = Readonly<{
  id: string; version: number; status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  campaignType: "PERCENTAGE_DISCOUNT" | "FIXED_AMOUNT_DISCOUNT" | "FIXED_PROMOTIONAL_PRICE";
  percentage: Prisma.Decimal | null; fixedAmount: Prisma.Decimal | null; fixedPrice: Prisma.Decimal | null;
  effectiveFrom: Date; effectiveUntil: Date;
}>;
export type CampaignCandidate = Readonly<{
  campaignId: string; campaignVersion: number; campaignType: CampaignRuleInput["campaignType"];
  sellerOfferId: string;
  baseAmount: string; discountAmount: string; effectiveAmount: string; effectiveAt: string;
  targetScope: "SELLER_OFFER"; status: "ELIGIBLE";
}>;

export function calculateCampaignCandidate(sellerOfferId: string, baseValue: Prisma.Decimal.Value, campaign: CampaignRuleInput, effectiveAt: Date): CampaignCandidate | null {
  const base = new Prisma.Decimal(baseValue);
  if (!base.isFinite() || base.lte(0) || campaignTemporalState(campaign.status, campaign.effectiveFrom, campaign.effectiveUntil, effectiveAt) !== "ACTIVE") return null;
  let effective: Prisma.Decimal;
  if (campaign.campaignType === "PERCENTAGE_DISCOUNT" && campaign.percentage?.gt(0) && campaign.percentage.lt(100)) effective = base.mul(new Prisma.Decimal(100).minus(campaign.percentage)).div(100);
  else if (campaign.campaignType === "FIXED_AMOUNT_DISCOUNT" && campaign.fixedAmount?.gt(0)) effective = base.minus(campaign.fixedAmount);
  else if (campaign.campaignType === "FIXED_PROMOTIONAL_PRICE" && campaign.fixedPrice?.gt(0)) effective = campaign.fixedPrice;
  else return null;
  effective = effective.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (effective.lte(0) || effective.gte(base)) return null;
  return { campaignId: campaign.id, campaignVersion: campaign.version, campaignType: campaign.campaignType, sellerOfferId, baseAmount: base.toFixed(2), discountAmount: base.minus(effective).toFixed(2), effectiveAmount: effective.toFixed(2), effectiveAt: effectiveAt.toISOString(), targetScope: "SELLER_OFFER", status: "ELIGIBLE" };
}

export function selectCampaignWinner(candidates: readonly (CampaignCandidate | null)[]): CampaignCandidate | null {
  return candidates.filter((value): value is CampaignCandidate => value !== null).sort((a, b) => new Prisma.Decimal(a.effectiveAmount).comparedTo(b.effectiveAmount) || a.campaignId.localeCompare(b.campaignId))[0] ?? null;
}
