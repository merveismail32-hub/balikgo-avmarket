import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { reserveRewardForCheckout } from "../app/lib/reward-checkout";
import { RewardDomainError } from "../app/lib/reward-domain";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const ids = { users: [] as string[], orders: [] as string[], policy: "" };
const now = new Date();
const code = (expected: string) => (error: unknown) => error instanceof RewardDomainError && error.code === expected;

async function customer(points: number) {
  const user = await db.user.create({ data: { name: "QA", surname: "Reward", email: `qa-reward-c-${randomUUID()}@invalid.local`, phone: "0", passwordHash: "not-used", role: "CUSTOMER", rewardAccount: { create: { availablePoints: points } } }, include: { rewardAccount: true } });
  ids.users.push(user.id); return user;
}
async function order(userId: string, amount = "100.00", discount = "0") {
  const clientRequestId = randomUUID();
  const value = await db.order.create({ data: { userId, clientRequestId, orderNumber: `REDEEM-${randomUUID()}`, subtotalAmount: new Prisma.Decimal(amount).add(discount), discountAmount: discount, totalAmount: amount, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA redemption checkout address" } });
  ids.orders.push(value.id); return value;
}
const apply = (userId: string, orderId: string, clientRequestId: string, intent: { requestedPoints?: number; useMaximum?: boolean }, amount = "100") => db.$transaction(tx => reserveRewardForCheckout(tx, { userId, orderId, clientRequestId, eligibleAmount: new Prisma.Decimal(amount), ...intent, effectiveAt: now }));

async function cleanup() {
  if (ids.users.length) await db.rewardTransaction.deleteMany({ where: { userId: { in: ids.users } } });
  if (ids.orders.length) await db.order.deleteMany({ where: { id: { in: ids.orders } } });
  if (ids.users.length) { await db.rewardAccount.deleteMany({ where: { userId: { in: ids.users } } }); await db.user.deleteMany({ where: { id: { in: ids.users } } }); }
  if (ids.policy) await db.rewardPolicy.deleteMany({ where: { id: ids.policy } });
}

async function main() {
  const latest = await db.rewardPolicy.aggregate({ where: { policyCode: "GLOBAL" }, _max: { version: true } });
  const policy = await db.rewardPolicy.create({ data: { policyCode: "GLOBAL", version: (latest._max.version ?? 0) + 1, status: "ACTIVE", earnAmountMinor: 1000, earnPoints: 10, redeemPoints: 10, redeemValueMinor: 100, expiryDays: 30, maxRedeemPoints: 1000, minimumPayableMinor: 100, effectiveFrom: new Date(now.getTime() - 3600_000) } }); ids.policy = policy.id;

  const normalUser = await customer(1000), normalOrder = await order(normalUser.id, "100", "20");
  const normal = await apply(normalUser.id, normalOrder.id, normalOrder.clientRequestId, { requestedPoints: 805 });
  assert.equal(normal.transaction.points, 800); assert.equal(normal.transaction.monetaryValueMinor, 8000); assert.equal(normal.totalAmount.toFixed(2), "20.00");
  const persisted = await db.order.findUniqueOrThrow({ where: { id: normalOrder.id } });
  assert.equal(persisted.subtotalAmount?.toFixed(2), "120.00"); assert.equal(persisted.discountAmount.toFixed(2), "20.00"); assert.equal(persisted.rewardDiscountAmount.toFixed(2), "80.00");
  assert.equal(persisted.rewardPolicyId, policy.id); assert.equal(persisted.rewardPolicyVersion, policy.version); assert.equal(persisted.rewardFundingSource, "PLATFORM"); assert.equal(persisted.rewardRoundingRule, "INTEGER_RATIO_FLOOR_V1");

  const maxUser = await customer(1000), maxOrder = await order(maxUser.id, "50");
  const maximum = await apply(maxUser.id, maxOrder.id, maxOrder.clientRequestId, { useMaximum: true }, "50"); assert.equal(maximum.transaction.points, 490); assert.equal(maximum.totalAmount.toFixed(2), "1.00");

  const limitUser = await customer(1000), insufficient = await order(limitUser.id), capped = await order(limitUser.id), floor = await order(limitUser.id, "1");
  await db.rewardAccount.update({ where: { userId: limitUser.id }, data: { availablePoints: 100 } });
  await assert.rejects(apply(limitUser.id, insufficient.id, insufficient.clientRequestId, { requestedPoints: 200 }), code("REWARD_INSUFFICIENT_POINTS"));
  await db.rewardAccount.update({ where: { userId: limitUser.id }, data: { availablePoints: 2000 } });
  await assert.rejects(apply(limitUser.id, capped.id, capped.clientRequestId, { requestedPoints: 1100 }), code("REWARD_REDEEM_LIMIT_EXCEEDED"));
  await assert.rejects(apply(limitUser.id, floor.id, floor.clientRequestId, { requestedPoints: 10 }, "1"), code("REWARD_PAYABLE_FLOOR_VIOLATION"));

  const replayUser = await customer(1000), replayOrder = await order(replayUser.id);
  const replayRace = await Promise.all([apply(replayUser.id, replayOrder.id, replayOrder.clientRequestId, { requestedPoints: 300 }), apply(replayUser.id, replayOrder.id, replayOrder.clientRequestId, { requestedPoints: 300 })]);
  assert.equal(replayRace.filter(x => x.replay).length, 1); assert.equal(await db.rewardTransaction.count({ where: { orderId: replayOrder.id, type: "REDEEM_RESERVED" } }), 1);
  await assert.rejects(apply(replayUser.id, replayOrder.id, replayOrder.clientRequestId, { requestedPoints: 400 }), code("REWARD_IDEMPOTENCY_CONFLICT"));
  const attacker = await customer(1000), attackerOrder = await order(attacker.id);
  await assert.rejects(db.$transaction(tx => reserveRewardForCheckout(tx, { userId: attacker.id, orderId: attackerOrder.id, clientRequestId: replayOrder.clientRequestId, eligibleAmount: new Prisma.Decimal(100), requestedPoints: 300, effectiveAt: now })), code("REWARD_NOT_ELIGIBLE"));

  const raceUser = await customer(1000), raceA = await order(raceUser.id), raceB = await order(raceUser.id);
  const race = await Promise.allSettled([apply(raceUser.id, raceA.id, raceA.clientRequestId, { requestedPoints: 800 }), apply(raceUser.id, raceB.id, raceB.clientRequestId, { requestedPoints: 800 })]);
  assert.equal(race.filter(x => x.status === "fulfilled").length, 1); assert.equal(race.filter(x => x.status === "rejected" && code("REWARD_INSUFFICIENT_POINTS")(x.reason)).length, 1);
  const raceAccount = await db.rewardAccount.findUniqueOrThrow({ where: { userId: raceUser.id } }); assert.equal(raceAccount.availablePoints, 200); assert.equal(raceAccount.reservedPoints, 800);
  assert.equal(await db.rewardTransaction.aggregate({ where: { userId: raceUser.id, type: "REDEEM_RESERVED" }, _sum: { points: true } }).then(x => x._sum.points), 800);

  const rollbackUser = await customer(1000), rollbackVersion = rollbackUser.rewardAccount!.version, rollbackRequest = randomUUID(), rollbackOrderNumber = `ROLLBACK-${randomUUID()}`;
  await assert.rejects(db.$transaction(async tx => { const created = await tx.order.create({ data: { userId: rollbackUser.id, clientRequestId: rollbackRequest, orderNumber: rollbackOrderNumber, totalAmount: 100, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA rollback redemption address" } }); await reserveRewardForCheckout(tx, { userId: rollbackUser.id, orderId: created.id, clientRequestId: rollbackRequest, eligibleAmount: new Prisma.Decimal(100), requestedPoints: 500, effectiveAt: now }); throw new Error("FORCED_ROLLBACK"); }));
  assert.equal(await db.order.count({ where: { clientRequestId: rollbackRequest } }), 0); assert.equal(await db.rewardTransaction.count({ where: { idempotencyKey: `reward-redemption:v1:${rollbackRequest}:${rollbackUser.id}` } }), 0);
  const rollbackAccount = await db.rewardAccount.findUniqueOrThrow({ where: { userId: rollbackUser.id } }); assert.equal(rollbackAccount.availablePoints, 1000); assert.equal(rollbackAccount.reservedPoints, 0); assert.equal(rollbackAccount.version, rollbackVersion);

  await db.rewardPolicy.update({ where: { id: policy.id }, data: { redeemValueMinor: 999 } });
  const immutable = await db.rewardTransaction.findUniqueOrThrow({ where: { id: normal.transaction.id } }); assert.equal(immutable.conversionValueMinor, 100); assert.equal(immutable.monetaryValueMinor, 8000);
  console.log("PASS: guarded TEST reward reserve, partial/max, limits/floor, immutable snapshots, replay/isolation, row-lock double-spend and rollback");
}

cleanup().then(main).finally(async () => { await cleanup(); assert.equal(await db.user.count({ where: { id: { in: ids.users } } }), 0); console.log("PASS: exact cleanup"); await db.$disconnect(); });
