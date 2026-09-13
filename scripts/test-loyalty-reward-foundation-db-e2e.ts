import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { createPendingEarn, expireAvailableReward, makeRewardAvailable, reverseRewardEarn } from "../app/lib/reward-ledger";
import { RewardDomainError } from "../app/lib/reward-domain";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const tag = randomUUID(), ids = { users: [] as string[], orders: [] as string[], policies: [] as string[] };
const code = (value: string) => (error: unknown) => error instanceof RewardDomainError && error.code === value;
const now = new Date();

async function order(userId: string) {
  const value = await db.order.create({ data: { userId, orderNumber: `REWARD-${randomUUID()}`, clientRequestId: randomUUID(), totalAmount: 250, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", payment: { create: { amount: 250, provider: "QA", idempotencyKey: randomUUID(), status: "PAID", paidAt: now } } } });
  ids.orders.push(value.id); return value;
}
const pendingInput = (userId: string, orderId: string, key: string, effectiveAt = now) => ({ userId, orderId, idempotencyKey: key, effectiveAt, eligibleAmountMinor: 25_000, eventAuthority: "PAYMENT_PAID_VERIFIED" as const });

async function main() {
  const identity = await db.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database,current_user role`;
  assert.deepEqual(identity[0], { database: TEST_DB_IDENTITY.database, role: "postgres" });
  const user = await db.user.create({ data: { name: "QA", surname: "Reward", email: `${tag}@invalid.local`, phone: "0", passwordHash: "test-only" } }); ids.users.push(user.id);
  const policy = await db.rewardPolicy.create({ data: { policyCode: `QA-${tag}`, version: 7, status: "ACTIVE", earnAmountMinor: 10_000, earnPoints: 10, redeemPoints: 10, redeemValueMinor: 100, expiryDays: 1, maxEarnPoints: 100, effectiveFrom: new Date(now.getTime() - 10 * 86_400_000) } }); ids.policies.push(policy.id);
  // The authoritative primitive resolves GLOBAL; isolate this test with one active global version.
  await db.rewardPolicy.update({ where: { id: policy.id }, data: { policyCode: "GLOBAL" } });
  const firstOrder = await order(user.id), earnKey = `reward:${tag}:earn`;
  const results = await Promise.all([
    db.$transaction(tx => createPendingEarn(tx, pendingInput(user.id, firstOrder.id, earnKey))),
    db.$transaction(tx => createPendingEarn(tx, pendingInput(user.id, firstOrder.id, earnKey))),
  ]);
  assert.equal(results.filter(result => !result.replay).length, 1); assert.equal(results[0].transaction.id, results[1].transaction.id);
  assert.equal(await db.rewardAccount.count({ where: { userId: user.id } }), 1); assert.equal(await db.rewardTransaction.count({ where: { idempotencyKey: earnKey } }), 1);
  const pending = results[0].transaction; assert.equal(pending.points, 20); assert.equal(pending.policyVersion, 7);
  const replay = await db.$transaction(tx => createPendingEarn(tx, pendingInput(user.id, firstOrder.id, earnKey))); assert.equal(replay.replay, true);
  const secondOrder = await order(user.id);
  await assert.rejects(db.$transaction(tx => createPendingEarn(tx, pendingInput(user.id, secondOrder.id, earnKey))), code("REWARD_IDEMPOTENCY_CONFLICT"));

  const accountV1 = await db.rewardAccount.findUniqueOrThrow({ where: { userId: user.id } });
  const available = await db.$transaction(tx => makeRewardAvailable(tx, { userId: user.id, orderId: firstOrder.id, pendingEarnId: pending.id, idempotencyKey: `reward:${tag}:available`, effectiveAt: now, expectedAccountVersion: accountV1.version }));
  assert.equal(available.replay, false); assert.equal((await db.rewardAccount.findUniqueOrThrow({ where: { userId: user.id } })).availablePoints, 20);
  assert.equal((await db.$transaction(tx => makeRewardAvailable(tx, { userId: user.id, orderId: firstOrder.id, pendingEarnId: pending.id, idempotencyKey: `reward:${tag}:available`, effectiveAt: now }))).replay, true);
  await assert.rejects(db.$transaction(tx => makeRewardAvailable(tx, { userId: user.id, orderId: firstOrder.id, pendingEarnId: pending.id, idempotencyKey: `reward:${tag}:available-stale`, effectiveAt: now, expectedAccountVersion: 1 })), code("REWARD_STALE_STATE"));

  // Simulate future redemption consuming the available projection; reversal must support debt.
  await db.rewardAccount.update({ where: { userId: user.id }, data: { availablePoints: 0 } });
  const beforeReverse = await db.rewardAccount.findUniqueOrThrow({ where: { userId: user.id } });
  const reversed = await db.$transaction(tx => reverseRewardEarn(tx, { userId: user.id, orderId: firstOrder.id, pendingEarnId: pending.id, idempotencyKey: `reward:${tag}:reverse`, effectiveAt: now, reason: "ORDER_REFUNDED", expectedAccountVersion: beforeReverse.version }));
  assert.equal(reversed.transaction.points, -20); assert.equal((await db.rewardAccount.findUniqueOrThrow({ where: { userId: user.id } })).availablePoints, -20);
  assert.equal((await db.$transaction(tx => reverseRewardEarn(tx, { userId: user.id, orderId: firstOrder.id, pendingEarnId: pending.id, idempotencyKey: `reward:${tag}:reverse`, effectiveAt: now, reason: "ORDER_REFUNDED" }))).replay, true);

  const expiryUser = await db.user.create({ data: { name: "QA", surname: "Expiry", email: `${tag}-expiry@invalid.local`, phone: "0", passwordHash: "test-only" } }); ids.users.push(expiryUser.id);
  const expiryOrder = await order(expiryUser.id), past = new Date(now.getTime() - 2 * 86_400_000);
  const expiryPending = await db.$transaction(tx => createPendingEarn(tx, pendingInput(expiryUser.id, expiryOrder.id, `reward:${tag}:expiry-earn`, past)));
  const expiryAccount = await db.rewardAccount.findUniqueOrThrow({ where: { userId: expiryUser.id } });
  const expiryAvailable = await db.$transaction(tx => makeRewardAvailable(tx, { userId: expiryUser.id, orderId: expiryOrder.id, pendingEarnId: expiryPending.transaction.id, idempotencyKey: `reward:${tag}:expiry-available`, effectiveAt: past, expectedAccountVersion: expiryAccount.version }));
  const expired = await db.$transaction(tx => expireAvailableReward(tx, { userId: expiryUser.id, orderId: expiryOrder.id, availableTransactionId: expiryAvailable.transaction.id, idempotencyKey: `reward:${tag}:expired`, effectiveAt: now }));
  assert.equal(expired.transaction.points, -20); assert.equal((await db.rewardAccount.findUniqueOrThrow({ where: { userId: expiryUser.id } })).availablePoints, 0);
  assert.equal((await db.$transaction(tx => expireAvailableReward(tx, { userId: expiryUser.id, orderId: expiryOrder.id, availableTransactionId: expiryAvailable.transaction.id, idempotencyKey: `reward:${tag}:expired`, effectiveAt: now }))).replay, true);
  await assert.rejects(db.$transaction(tx => reverseRewardEarn(tx, { userId: expiryUser.id, orderId: expiryOrder.id, pendingEarnId: expiryPending.transaction.id, idempotencyKey: `reward:${tag}:expired-reverse`, effectiveAt: now, reason: "ORDER_REFUNDED" })), code("REWARD_REVERSAL_CONFLICT"));

  const rollbackUser = await db.user.create({ data: { name: "QA", surname: "Rollback", email: `${tag}-rollback@invalid.local`, phone: "0", passwordHash: "test-only" } }); ids.users.push(rollbackUser.id);
  const rollbackOrder = await order(rollbackUser.id), rollbackKey = `reward:${tag}:rollback`;
  await assert.rejects(db.$transaction(async tx => { await createPendingEarn(tx, pendingInput(rollbackUser.id, rollbackOrder.id, rollbackKey)); throw new Error("FORCED_ROLLBACK"); }));
  assert.equal(await db.rewardTransaction.count({ where: { idempotencyKey: rollbackKey } }), 0); assert.equal(await db.rewardAccount.count({ where: { userId: rollbackUser.id } }), 0);
  const nextPolicy = await db.rewardPolicy.create({ data: { policyCode: "GLOBAL", version: 8, status: "INACTIVE", earnAmountMinor: 10_000, earnPoints: 99, redeemPoints: 10, redeemValueMinor: 100, expiryDays: 1, effectiveFrom: new Date(now.getTime() + 86_400_000) } }); ids.policies.push(nextPolicy.id);
  const historical = await db.rewardTransaction.findUniqueOrThrow({ where: { id: pending.id } }); assert.equal(historical.points, 20); assert.equal(historical.policyVersion, 7);
  console.log("PASS: guarded TEST loyalty account uniqueness, policy snapshot, replay/conflict, concurrent earn, CAS, availability, reversal debt, expiry, rollback and append-only history");
}

main().finally(async () => {
  await db.rewardTransaction.deleteMany({ where: { userId: { in: ids.users } } });
  await db.rewardAccount.deleteMany({ where: { userId: { in: ids.users } } });
  await db.payment.deleteMany({ where: { orderId: { in: ids.orders } } });
  await db.order.deleteMany({ where: { id: { in: ids.orders } } });
  await db.rewardPolicy.deleteMany({ where: { id: { in: ids.policies } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  console.log("PASS: cleanup"); await db.$disconnect();
});
