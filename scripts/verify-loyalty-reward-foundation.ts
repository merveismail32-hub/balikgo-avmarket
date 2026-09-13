import assert from "node:assert/strict";
import { calculateEarnPoints, RewardDomainError, assertPositiveInteger } from "../app/lib/reward-domain";

assert.equal(calculateEarnPoints({ eligibleAmountMinor: 25_000, earnAmountMinor: 10_000, earnPoints: 10, maxEarnPoints: null }), 20);
assert.equal(calculateEarnPoints({ eligibleAmountMinor: 100_000, earnAmountMinor: 10_000, earnPoints: 10, maxEarnPoints: 50 }), 50);
assert.throws(() => assertPositiveInteger(1.5), (error: unknown) => error instanceof RewardDomainError && error.code === "REWARD_TRANSACTION_INVALID");
assert.throws(() => calculateEarnPoints({ eligibleAmountMinor: 1, earnAmountMinor: 100, earnPoints: 1, maxEarnPoints: null }), (error: unknown) => error instanceof RewardDomainError && error.code === "REWARD_TRANSACTION_INVALID");
console.log("PASS: integer reward calculation, cap and invalid transaction guards");
