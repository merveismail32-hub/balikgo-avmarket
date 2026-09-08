import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const model=readFileSync(new URL("../app/lib/pricing-intelligence-read-model.ts",import.meta.url),"utf8");const admin=readFileSync(new URL("../app/api/admin/pricing-intelligence/route.ts",import.meta.url),"utf8");const seller=readFileSync(new URL("../app/api/seller/pricing-intelligence/[sellerOfferId]/route.ts",import.meta.url),"utf8");
assert(admin.includes('session.user.role!=="ADMIN"'));assert(seller.includes('session.user.role!=="SELLER"'));assert(model.includes("sellerId: actor.sellerProfile.id"),"seller ownership is not server-bound");assert(model.includes("take: take + 1"));assert(model.includes("value > 50"));assert(model.includes('source: { not: "ADMIN_PRICE_OVERRIDE" }'),"timeline does not deduplicate admin observation/intervention");
for(const write of [".update(",".updateMany(",".create(",".delete(","setSellerOfferPrice","enforcePriceAnomalyPublication"])assert(!model.includes(write),`read model imports or performs write authority: ${write}`);
assert(!seller.includes("sellerId:z")&&!seller.includes("sellerId:"),"seller route accepts sellerId authority");assert(!admin.includes("priceAnomalyHeld:false"),"admin read route contains publication mutation");
console.log("PASS: #25 Slice G role/ownership, bounded query, timeline dedupe and read-only authority static contract");
