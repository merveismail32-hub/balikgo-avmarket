import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../app/lib/admin-price-override.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/seller-offers/[sellerOfferId]/price-override/route.ts", import.meta.url), "utf8");
assert(service.includes('actor?.role !== "ADMIN"'));
assert(service.includes('source: "ADMIN_PRICE_OVERRIDE"'));
assert(service.includes("setSellerOfferPrice(tx"), "Slice B mutation core is not reused");
assert(service.includes("adminPriceIntervention.create"), "typed audit is missing");
assert(service.includes("getSellerPricingAnomalyEvaluation"), "fresh anomaly evidence is missing");
assert(!service.includes("priceAnomalyHeld: false"), "admin service contains direct force-publish bypass");
assert(route.includes('session.user.role !== "ADMIN"'));
assert(route.includes("expectedPriceVersion") && route.includes("reason"));
assert(!route.includes("active:"), "route directly controls publication state");
console.log("PASS: #25 Slice F ADMIN-only CAS override, mandatory reason, core reuse, audit and no force-publish boundary");
