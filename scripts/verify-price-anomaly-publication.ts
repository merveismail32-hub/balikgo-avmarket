import assert from "node:assert/strict";
import { getOfferEligibility, resolveBuybox } from "../app/lib/buybox";
import { isSellerOfferPublicationEligible } from "../app/lib/offer-publication-eligibility";
import { requiresAutomaticPriceHold, PRICE_ANOMALY_ENFORCEMENT_VERSION } from "../app/lib/price-anomaly-enforcement-policy";
import { readFileSync } from "node:fs";

assert.equal(requiresAutomaticPriceHold({ status: "CRITICAL", confidence: "HIGH" }), true);
for (const [status, confidence] of [["CRITICAL", "MEDIUM"], ["SUSPICIOUS", "HIGH"], ["NORMAL", "HIGH"], ["INSUFFICIENT_EVIDENCE", "LOW"]] as const) assert.equal(requiresAutomaticPriceHold({ status, confidence }), false);
assert.equal(isSellerOfferPublicationEligible({ priceAnomalyHeld: true }), false);
const catalog = { id: "c", active: true, moderationStatus: "APPROVED" };
const offer = { id: "o", catalogProductId: "c", sellerId: "s", price: 1, stock: 1, active: true, priceAnomalyHeld: true, handlingTimeDays: 0, sellerStatus: "APPROVED" };
assert(getOfferEligibility(catalog, offer).includes("PRICE_ANOMALY_HELD"));
assert.equal(resolveBuybox(catalog, [offer]).winner, null);
assert.equal(PRICE_ANOMALY_ENFORCEMENT_VERSION, "PRICE_ANOMALY_ENFORCEMENT_V1");
const checkout = readFileSync(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
assert(checkout.includes("publicProductPolicy") && checkout.includes("revalidateOffer") && checkout.indexOf("revalidateOffer") < checkout.indexOf("decrementForCheckout(tx"), "checkout does not fail closed before stock reservation");
console.log("PASS: #25 Slice E auto-hold policy and shared publication/Buybox eligibility");
