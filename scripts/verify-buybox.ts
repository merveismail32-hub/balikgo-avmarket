import { BUYBOX_ALGORITHM_VERSION, BUYBOX_WEIGHTS, getOfferEligibility, resolveBuybox, type BuyboxOfferInput } from "../app/lib/buybox.ts";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const catalog = { id: "catalog-a", active: true, moderationStatus: "APPROVED" };
const offer = (id: string, overrides: Partial<BuyboxOfferInput> = {}): BuyboxOfferInput => ({ id, catalogProductId: catalog.id, sellerId: `seller-${id}`, price: 100, stock: 5, active: true, handlingTimeDays: 2, sellerStatus: "APPROVED", sellerPerformance: { successfulOrders: 15, totalOrders: 20 }, ...overrides });

assert(resolveBuybox(catalog, [offer("cheap", { price: 100, sellerPerformance: { successfulOrders: 0, totalOrders: 100 } }), offer("strong", { price: 101, sellerPerformance: { successfulOrders: 100, totalOrders: 100 } })]).winner?.id === "strong", "A: scoring collapsed to lowest-price sorting.");
assert(resolveBuybox(catalog, [offer("empty", { stock: 0, sellerPerformance: { successfulOrders: 100, totalOrders: 100 } }), offer("available")]).winner?.id === "available", "B: out-of-stock offer won.");
assert(resolveBuybox(catalog, [offer("inactive", { active: false }), offer("active")]).winner?.id === "active", "C: inactive offer won.");
assert(resolveBuybox(catalog, [offer("suspended", { sellerStatus: "SUSPENDED" }), offer("approved")]).winner?.id === "approved", "D: ineligible seller won.");
assert(resolveBuybox({ ...catalog, active: false }, [offer("one")]).winner === null, "E: inactive catalog produced a winner.");
assert(getOfferEligibility(catalog, offer("invalid", { price: 0 })).includes("INVALID_PRICE"), "F: invalid price was eligible.");
assert(resolveBuybox(catalog, [offer("single")]).winner?.id === "single", "G: single offer failed.");
const tied = [offer("z"), offer("a")]; assert(resolveBuybox(catalog, tied).winner?.id === "a" && resolveBuybox(catalog, tied).winner?.id === "a", "H: tie-break is not stable.");
const depleted = offer("first", { stock: 1, price: 90 }); const fallback = offer("fallback", { price: 110 }); assert(resolveBuybox(catalog, [depleted, fallback]).winner?.id === "first", "I: fixture winner invalid."); depleted.stock = 0; assert(resolveBuybox(catalog, [depleted, fallback]).winner?.id === "fallback", "I: depletion did not promote fallback.");
const deactivated = offer("deactivated", { price: 90, active: false }); assert(resolveBuybox(catalog, [deactivated, fallback]).winner?.id === "fallback", "J: deactivation did not promote fallback.");
const suspended = offer("seller-off", { price: 90, sellerStatus: "SUSPENDED" }); assert(resolveBuybox(catalog, [suspended, fallback]).winner?.id === "fallback", "K: suspension did not promote fallback.");
const changing = offer("changing", { price: 90 }); assert(resolveBuybox(catalog, [changing, fallback]).winner?.id === "changing", "L: initial price winner invalid."); changing.price = 200; assert(resolveBuybox(catalog, [changing, fallback]).winner?.id === "fallback", "L: price change did not re-rank.");
assert(resolveBuybox(catalog, []).winner === null, "M: no-offer state failed.");
assert(resolveBuybox(catalog, [offer("none-1", { stock: 0 }), offer("none-2", { stock: 0 })]).winner === null, "N: all-out-of-stock state failed.");
assert(resolveBuybox(catalog, [offer("variant-2500"), offer("variant-4000", { catalogProductId: "catalog-4000", price: 1 })]).alternatives.every((item) => item.id !== "variant-4000"), "O: variant mismatch entered pool.");
assert(resolveBuybox(catalog, [offer("foreign", { catalogProductId: "catalog-b" })]).winner === null, "P: foreign catalog offer entered pool.");
assert(Math.abs(Object.values(BUYBOX_WEIGHTS).reduce((sum, value) => sum + value, 0) - 1) < Number.EPSILON, "Weights do not sum to 1.");
assert(BUYBOX_ALGORITHM_VERSION === "v1", "Algorithm version changed unexpectedly.");
console.log("PASS: Buybox A-P eligibility, scoring, deterministic ranking, fallback and isolation matrix verified.");
