import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { normalizeCampaign, campaignTemporalState as temporal, createCampaignSchema, parseCampaignInput } from "../app/lib/campaign-domain";
const now = new Date("2030-01-01T00:00:00Z"), from = new Date("2030-01-02T00:00:00Z"), until = new Date("2030-01-03T00:00:00Z");
const base = { internalName: " Test ", campaignType: "PERCENTAGE_DISCOUNT", percentage: "20.5", effectiveFrom: from.toISOString(), effectiveUntil: until.toISOString() };
assert.equal(normalizeCampaign(base, now).percentage!.toFixed(2), "20.50");
for (const percentage of ["0", "-1", "100", "NaN", "1.001", 20.5]) assert.throws(() => normalizeCampaign({ ...base, percentage }, now));
for (const [campaignType, field] of [["FIXED_AMOUNT_DISCOUNT", "fixedAmount"], ["FIXED_PROMOTIONAL_PRICE", "fixedPrice"]]) {
  const valid = { ...base, campaignType, percentage: null, [field]: "12.30" };
  assert.equal(normalizeCampaign(valid, now)[field as "fixedAmount" | "fixedPrice"]!.toFixed(2), "12.30");
  for (const value of ["0", "-1", "10000000000", "Infinity"]) assert.throws(() => normalizeCampaign({ ...valid, [field]: value }, now));
}
assert.throws(() => normalizeCampaign({ ...base, fixedAmount: "1" }, now));
assert.throws(() => normalizeCampaign({ ...base, effectiveUntil: base.effectiveFrom }, now));
assert.throws(() => normalizeCampaign(base, until));
assert.doesNotThrow(() => normalizeCampaign(base, from));
assert.throws(() => normalizeCampaign({ ...base, effectiveFrom: "2030-01-02T00:00:00" }, now));
for (const field of ["actorUserId", "version", "createdAt", "audit", "temporalState"]) assert.throws(() => parseCampaignInput(createCampaignSchema, { ...base, reason: "test reason", [field]: 1 }));
assert.equal(temporal("DRAFT", from, until, from), "DRAFT");
assert.equal(temporal("PUBLISHED", from, until, now), "UPCOMING");
assert.equal(temporal("PUBLISHED", from, until, from), "ACTIVE");
assert.equal(temporal("PUBLISHED", from, until, until), "ENDED");
assert.equal(temporal("CANCELLED", from, until, now), "CANCELLED");
assert.deepEqual(normalizeCampaign(base, now), normalizeCampaign({ ...base, percentage: "20.50" }, now));
const files = execFileSync("git", ["ls-files", "app"], { encoding: "utf8" }).trim().split(/\r?\n/);
const laterSliceIntegrationFiles = new Set([
  "app/api/orders/route.ts",
  "app/lib/coupon-evaluation.ts",
  "app/lib/customer-order-select.ts",
]);
for (const path of files.filter(p => /\.tsx?$/.test(p) && !laterSliceIntegrationFiles.has(p))) assert.equal(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" }), `Unrelated production behavior changed: ${path}`);
console.log("PASS: campaign rules, strict DTO, decimals, time boundaries, deterministic normalization; unrelated production files unchanged");
