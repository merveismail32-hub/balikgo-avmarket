import assert from "node:assert/strict";
import { calculateRedemption, RewardDomainError } from "../app/lib/reward-domain";

const partial = calculateRedemption({ availablePoints: 1000, requestedPoints: 805, redeemPoints: 10, redeemValueMinor: 100, maxRedeemPoints: null, eligibleAmountMinor: 20_000, minimumPayableMinor: 100 });
assert.deepEqual(partial, { reservedPoints: 800, monetaryValueMinor: 8000, conversionPoints: 10, conversionValueMinor: 100, roundingRule: "INTEGER_RATIO_FLOOR_V1" });
const maximum = calculateRedemption({ availablePoints: 1000, useMaximum: true, redeemPoints: 10, redeemValueMinor: 100, maxRedeemPoints: 500, eligibleAmountMinor: 4_500, minimumPayableMinor: 500 });
assert.equal(maximum.reservedPoints, 400);
const code = (value: string) => (error: unknown) => error instanceof RewardDomainError && error.code === value;
assert.throws(() => calculateRedemption({ availablePoints: 100, requestedPoints: 200, redeemPoints: 10, redeemValueMinor: 100, maxRedeemPoints: null, eligibleAmountMinor: 10_000, minimumPayableMinor: 0 }), code("REWARD_INSUFFICIENT_POINTS"));
assert.throws(() => calculateRedemption({ availablePoints: 1000, requestedPoints: 600, redeemPoints: 10, redeemValueMinor: 100, maxRedeemPoints: 500, eligibleAmountMinor: 10_000, minimumPayableMinor: 0 }), code("REWARD_REDEEM_LIMIT_EXCEEDED"));
assert.throws(() => calculateRedemption({ availablePoints: 1000, requestedPoints: 10, redeemPoints: 10, redeemValueMinor: 100, maxRedeemPoints: null, eligibleAmountMinor: 100, minimumPayableMinor: 100 }), code("REWARD_PAYABLE_FLOOR_VIOLATION"));
console.log("PASS: deterministic integer redemption conversion, floor, cap and stable errors");
