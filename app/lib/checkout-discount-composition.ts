import { Prisma } from "@prisma/client";
import type { CampaignCandidate } from "./campaign-domain";

export class CheckoutCompositionError extends Error {
  readonly code = "INVALID_EFFECTIVE_MERCHANDISE_PRICE" as const;
  constructor() { super("INVALID_EFFECTIVE_MERCHANDISE_PRICE"); }
}

type CouponCandidate = Readonly<{ couponId: string; couponReference: string; discountAmount: Prisma.Decimal.Value }> | null;

export function composeCheckoutDiscount(input: Readonly<{ sellerOfferId: string; baseUnitPrice: Prisma.Decimal.Value; quantity: number; effectiveAt: Date; campaign: CampaignCandidate | null; coupon: CouponCandidate }>) {
  const baseUnitPrice = new Prisma.Decimal(input.baseUnitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!input.sellerOfferId || !Number.isInteger(input.quantity) || input.quantity <= 0 || !Number.isFinite(input.effectiveAt.getTime()) || !baseUnitPrice.isFinite() || baseUnitPrice.lte(0)) throw new CheckoutCompositionError();
  const baseLineAmount = baseUnitPrice.mul(input.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  let campaignLineAmount: Prisma.Decimal | null = null;
  if (input.campaign) {
    const campaignBase = new Prisma.Decimal(input.campaign.baseAmount), effective = new Prisma.Decimal(input.campaign.effectiveAmount);
    if (input.campaign.sellerOfferId !== input.sellerOfferId || !campaignBase.eq(baseUnitPrice) || effective.lte(0) || effective.gte(baseUnitPrice)) throw new CheckoutCompositionError();
    campaignLineAmount = effective.mul(input.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  let couponLineAmount: Prisma.Decimal | null = null;
  let couponDiscount = new Prisma.Decimal(0);
  if (input.coupon) {
    couponDiscount = new Prisma.Decimal(input.coupon.discountAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    couponLineAmount = baseLineAmount.minus(couponDiscount);
    if (!couponDiscount.isFinite() || couponDiscount.lt(0) || couponLineAmount.lte(0)) throw new CheckoutCompositionError();
    if (couponDiscount.eq(0)) couponLineAmount = null;
  }
  const campaignWins = campaignLineAmount !== null && (couponLineAmount === null || campaignLineAmount.lte(couponLineAmount));
  const couponWins = !campaignWins && couponLineAmount !== null && couponLineAmount.lt(baseLineAmount);
  const mode = campaignWins ? "CAMPAIGN_ONLY" as const : couponWins ? "COUPON_ONLY" as const : "NONE" as const;
  const finalLineAmount = campaignWins ? campaignLineAmount! : couponWins ? couponLineAmount! : baseLineAmount;
  const selectedDiscount = baseLineAmount.minus(finalLineAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const effectiveUnitPrice = finalLineAmount.div(input.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (finalLineAmount.lte(0) || effectiveUnitPrice.lte(0)) throw new CheckoutCompositionError();
  return Object.freeze({
    baseUnitPrice, baseLineAmount, finalLineAmount, effectiveUnitPrice, selectedDiscount,
    compositionMode: mode, discountSource: campaignWins ? "CAMPAIGN" as const : couponWins ? "COUPON" as const : "NONE" as const,
    campaignCandidate: input.campaign, couponCandidate: input.coupon,
    campaignDiscountAmount: campaignWins ? selectedDiscount : new Prisma.Decimal(0),
    couponDiscountAmount: couponWins ? selectedDiscount : new Prisma.Decimal(0),
    campaignApplied: campaignWins, couponApplied: couponWins,
    pricingEffectiveAt: input.effectiveAt,
  });
}
