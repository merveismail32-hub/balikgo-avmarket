import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { composeCheckoutDiscount, CheckoutCompositionError } from "../app/lib/checkout-discount-composition";
import type { CampaignCandidate } from "../app/lib/campaign-domain";

const at = new Date("2035-01-01T00:00:00.000Z");
const campaign = (effectiveAmount: string): CampaignCandidate => ({ campaignId: "campaign-1", campaignVersion: 3, campaignType: "PERCENTAGE_DISCOUNT", sellerOfferId: "offer-1", baseAmount: "1000.00", discountAmount: new Prisma.Decimal(1000).minus(effectiveAmount).toFixed(2), effectiveAmount, effectiveAt: at.toISOString(), targetScope: "SELLER_OFFER", status: "ELIGIBLE" });
const input = { sellerOfferId: "offer-1", baseUnitPrice: "1000", quantity: 1, effectiveAt: at } as const;

const none = composeCheckoutDiscount({ ...input, campaign: null, coupon: null });
assert.deepEqual({ mode: none.compositionMode, final: none.finalLineAmount.toFixed(2), discount: none.selectedDiscount.toFixed(2) }, { mode: "NONE", final: "1000.00", discount: "0.00" });
const campaignOnly = composeCheckoutDiscount({ ...input, campaign: campaign("900"), coupon: null });
assert.deepEqual({ mode: campaignOnly.compositionMode, final: campaignOnly.finalLineAmount.toFixed(2), campaign: campaignOnly.campaignDiscountAmount.toFixed(2), coupon: campaignOnly.couponDiscountAmount.toFixed(2) }, { mode: "CAMPAIGN_ONLY", final: "900.00", campaign: "100.00", coupon: "0.00" });
const couponOnly = composeCheckoutDiscount({ ...input, campaign: null, coupon: { couponId: "coupon-1", couponReference: "SAVE10", discountAmount: "100" } });
assert.deepEqual({ mode: couponOnly.compositionMode, final: couponOnly.finalLineAmount.toFixed(2), campaign: couponOnly.campaignDiscountAmount.toFixed(2), coupon: couponOnly.couponDiscountAmount.toFixed(2) }, { mode: "COUPON_ONLY", final: "900.00", campaign: "0.00", coupon: "100.00" });
const noStack = composeCheckoutDiscount({ ...input, campaign: campaign("900"), coupon: { couponId: "coupon-1", couponReference: "SAVE10", discountAmount: "100" } });
assert.equal(noStack.compositionMode, "CAMPAIGN_ONLY"); assert.equal(noStack.finalLineAmount.toFixed(2), "900.00");
const couponWins = composeCheckoutDiscount({ ...input, campaign: campaign("900"), coupon: { couponId: "coupon-1", couponReference: "SAVE20", discountAmount: "200" } });
assert.equal(couponWins.compositionMode, "COUPON_ONLY"); assert.equal(couponWins.finalLineAmount.toFixed(2), "800.00");
const campaignWins = composeCheckoutDiscount({ ...input, campaign: campaign("800"), coupon: { couponId: "coupon-1", couponReference: "SAVE10", discountAmount: "100" } });
assert.equal(campaignWins.compositionMode, "CAMPAIGN_ONLY"); assert.equal(campaignWins.finalLineAmount.toFixed(2), "800.00");
const allocation = composeCheckoutDiscount({ ...input, baseUnitPrice: "10", quantity: 3, campaign: null, coupon: { couponId: "coupon-1", couponReference: "CENT", discountAmount: "0.01" } });
assert.equal(allocation.finalLineAmount.toFixed(2), "29.99"); assert.equal(allocation.effectiveUnitPrice.toFixed(2), "10.00");
assert.throws(() => composeCheckoutDiscount({ ...input, campaign: null, coupon: { couponId: "coupon-1", couponReference: "FREE", discountAmount: "1000" } }), CheckoutCompositionError);
assert.throws(() => composeCheckoutDiscount({ ...input, campaign: { ...campaign("900"), sellerOfferId: "spoofed" }, coupon: null }), CheckoutCompositionError);
console.log("PASS: Slice D explicit NONE/CAMPAIGN_ONLY/COUPON_ONLY composition, no stacking, deterministic lowest/tie, positive money, Decimal allocation and client-candidate binding");
