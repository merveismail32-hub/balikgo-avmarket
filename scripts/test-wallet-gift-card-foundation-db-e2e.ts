import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { activateGiftCard, claimGiftCard, creditWallet, expireGiftCard, issueGiftCard, voidGiftCard } from "../app/lib/stored-value";
import { giftCardDigest, storedValueCurrency, storedValueMoney, StoredValueDomainError } from "../app/lib/stored-value-domain";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const tag = randomUUID(), now = new Date(), secret = "qa-only-gift-card-hmac-secret-32-bytes-minimum";
const ids = { users: [] as string[], orders: [] as string[], payments: [] as string[], cards: [] as string[] };
const isCode = (value: string) => (error: unknown) => error instanceof StoredValueDomainError && error.code === value;

async function user(suffix: string) {
  const value = await db.user.create({ data: { name: "QA", surname: "Wallet", email: `${tag}-${suffix}@invalid.local`, phone: "0", passwordHash: "test-only" } });
  ids.users.push(value.id); return value;
}

async function payment(userId: string, amount = "100.00", status: "PENDING" | "PAID" = "PENDING") {
  const order = await db.order.create({ data: { userId, orderNumber: `WALLET-${randomUUID()}`, clientRequestId: randomUUID(), totalAmount: amount, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA" } });
  ids.orders.push(order.id);
  const value = await db.payment.create({ data: { orderId: order.id, amount, currency: "TRY", provider: "QA", status, idempotencyKey: randomUUID(), ...(status === "PAID" ? { paidAt: now } : {}) } });
  ids.payments.push(value.id); return value;
}

async function issued(userId: string, value = "100.00", suffix = randomUUID(), expiresAt?: Date) {
  const pay = await payment(userId, value);
  const result = await db.$transaction(tx => issueGiftCard(tx, { purchaserUserId: userId, purchasePaymentId: pay.id, amount: value, currency: "TRY", sourceReference: `purchase:${suffix}`, idempotencyKey: `gift-card-issue:v1:${suffix}`, correlationId: suffix, expiresAt, effectiveAt: now, hmacSecret: secret }));
  ids.cards.push(result.giftCard.id);
  return { ...result, payment: pay };
}

async function activate(fixture: Awaited<ReturnType<typeof issued>>, suffix = randomUUID()) {
  await db.payment.update({ where: { id: fixture.payment.id }, data: { status: "PAID", paidAt: now } });
  return db.$transaction(tx => activateGiftCard(tx, { giftCardId: fixture.giftCard.id, paymentId: fixture.payment.id, paymentEventId: `paid:${suffix}`, idempotencyKey: `gift-card-activate:v1:${suffix}`, effectiveAt: now }));
}

async function main() {
  const identity = await db.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database,current_user role`;
  assert.deepEqual(identity[0], { database: TEST_DB_IDENTITY.database, role: "postgres" });
  const constraints = await db.$queryRaw<Array<{ name: string }>>`SELECT conname name FROM pg_constraint WHERE conname IN ('WalletAccount_projection_check','WalletAccount_closed_check','GiftCard_amount_check','GiftCard_state_check','WalletTransaction_amount_check','WalletTransaction_projection_check')`;
  assert.equal(constraints.length, 6);
  const indexes = await db.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('WalletAccount_userId_currency_key','WalletTransaction_idempotencyKey_key','GiftCard_codeDigest_key','GiftCard_issuanceIdempotencyKey_key','GiftCardLifecycleEvent_idempotencyKey_key')`;
  assert.equal(indexes.length, 5);
  assert.equal(storedValueMoney("1.20").toFixed(2), "1.20");
  assert.throws(() => storedValueMoney("1.001"), isCode("STORED_VALUE_INVALID_AMOUNT"));
  assert.throws(() => storedValueMoney(new Prisma.Decimal(-1)), isCode("STORED_VALUE_INVALID_AMOUNT"));
  assert.throws(() => storedValueCurrency("USD"), isCode("STORED_VALUE_UNSUPPORTED_CURRENCY"));

  const owner = await user("owner"), other = await user("other");
  const issueKey = `gift-card-issue:v1:${tag}:primary`, primaryPayment = await payment(owner.id);
  const first = await db.$transaction(tx => issueGiftCard(tx, { purchaserUserId: owner.id, purchasePaymentId: primaryPayment.id, amount: "100.00", currency: "TRY", sourceReference: `purchase:${tag}:primary`, idempotencyKey: issueKey, effectiveAt: now, hmacSecret: secret }));
  ids.cards.push(first.giftCard.id); assert(first.rawCode && !first.giftCard.codeDigest.includes(first.rawCode));
  const issueReplay = await db.$transaction(tx => issueGiftCard(tx, { purchaserUserId: owner.id, purchasePaymentId: primaryPayment.id, amount: "100.00", currency: "TRY", sourceReference: `purchase:${tag}:primary`, idempotencyKey: issueKey, effectiveAt: now, hmacSecret: secret }));
  assert.equal(issueReplay.replay, true); assert.equal(issueReplay.rawCode, null); assert.equal(issueReplay.giftCard.id, first.giftCard.id);
  await assert.rejects(db.$transaction(tx => issueGiftCard(tx, { purchaserUserId: owner.id, purchasePaymentId: primaryPayment.id, amount: "99.00", currency: "TRY", sourceReference: `purchase:${tag}:primary`, idempotencyKey: issueKey, effectiveAt: now, hmacSecret: secret })), isCode("STORED_VALUE_IDEMPOTENCY_CONFLICT"));
  await assert.rejects(db.giftCard.create({ data: { status: "PENDING_PAYMENT", currency: "TRY", issuedAmount: 100, remainingAmount: 100, fundingSource: "PURCHASED_GIFT_CARD", sourceReference: `duplicate:${tag}`, codeDigest: first.giftCard.codeDigest, maskedSuffix: "ABCD", purchasePaymentId: primaryPayment.id, purchaserUserId: owner.id, issuanceIdempotencyKey: `duplicate:${tag}`, issuanceSemanticHash: "a".repeat(64) } }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
  assert.equal(giftCardDigest(first.rawCode!, secret), first.giftCard.codeDigest);

  await assert.rejects(db.$transaction(tx => activateGiftCard(tx, { giftCardId: first.giftCard.id, paymentId: primaryPayment.id, paymentEventId: `unpaid:${tag}`, idempotencyKey: `gift-card-activate:v1:unpaid:${tag}`, effectiveAt: now })), isCode("GIFT_CARD_PAYMENT_MISMATCH"));
  await db.payment.update({ where: { id: primaryPayment.id }, data: { status: "PAID", paidAt: now } });
  const activationKey = `gift-card-activate:v1:${tag}:primary`, activationInput = { giftCardId: first.giftCard.id, paymentId: primaryPayment.id, paymentEventId: `paid:${tag}:primary`, idempotencyKey: activationKey, effectiveAt: now };
  assert.equal((await db.$transaction(tx => activateGiftCard(tx, activationInput))).replay, false);
  assert.equal((await db.$transaction(tx => activateGiftCard(tx, activationInput))).replay, true);
  await assert.rejects(db.$transaction(tx => activateGiftCard(tx, { ...activationInput, paymentEventId: `different:${tag}` })), isCode("STORED_VALUE_IDEMPOTENCY_CONFLICT"));
  assert.equal(await db.giftCardLifecycleEvent.count({ where: { giftCardId: first.giftCard.id, type: "ACTIVATED" } }), 1);

  const claimed = await db.$transaction(tx => claimGiftCard(tx, { rawCode: first.rawCode!, userId: owner.id, hmacSecret: secret, correlationId: tag, effectiveAt: now }));
  assert.equal(claimed.replay, false); assert.equal(claimed.giftCard.status, "REDEEMED"); assert(claimed.giftCard.remainingAmount.equals(0));
  assert.equal((await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: owner.id, currency: "TRY" } } })).availableBalance.toFixed(2), "100.00");
  assert.equal((await db.$transaction(tx => claimGiftCard(tx, { rawCode: first.rawCode!, userId: owner.id, hmacSecret: secret, effectiveAt: now }))).replay, true);
  await assert.rejects(db.$transaction(tx => claimGiftCard(tx, { rawCode: first.rawCode!, userId: other.id, hmacSecret: secret, effectiveAt: now })), isCode("GIFT_CARD_CLAIM_CONFLICT"));
  await assert.rejects(db.$transaction(tx => activateGiftCard(tx, { ...activationInput, paymentEventId: `late:${tag}`, idempotencyKey: `gift-card-activate:v1:late:${tag}` })), isCode("GIFT_CARD_NOT_ACTIVATABLE"));
  assert.equal(await db.walletTransaction.count({ where: { giftCardId: first.giftCard.id } }), 1);

  const concurrentCard = await issued(owner.id, "40.00", `${tag}:concurrent`); await activate(concurrentCard, `${tag}:concurrent`);
  const claimRace = await Promise.all([1, 2].map(() => db.$transaction(tx => claimGiftCard(tx, { rawCode: concurrentCard.rawCode!, userId: owner.id, hmacSecret: secret, effectiveAt: now }))));
  assert.equal(claimRace.filter(result => !result.replay).length, 1); assert.equal(await db.walletTransaction.count({ where: { giftCardId: concurrentCard.giftCard.id } }), 1);

  const duplicateCreditKey = `wallet-credit:v1:${tag}:duplicate`;
  const creditInput = { userId: owner.id, amount: "5.00", currency: "TRY", fundingSource: "PLATFORM_PROMOTIONAL" as const, sourceType: "QA", sourceReference: `duplicate:${tag}`, idempotencyKey: duplicateCreditKey, reason: "QA", effectiveAt: now };
  const duplicateCredits = await Promise.all([1, 2].map(() => db.$transaction(tx => creditWallet(tx, creditInput))));
  assert.equal(duplicateCredits.filter(result => !result.replay).length, 1); assert.equal(await db.walletTransaction.count({ where: { idempotencyKey: duplicateCreditKey } }), 1);
  await assert.rejects(db.$transaction(tx => creditWallet(tx, { ...creditInput, amount: "6.00" })), isCode("STORED_VALUE_IDEMPOTENCY_CONFLICT"));
  const beforeDistinct = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: owner.id, currency: "TRY" } } });
  await Promise.all(["a", "b"].map(value => db.$transaction(tx => creditWallet(tx, { ...creditInput, amount: "3.00", sourceReference: `${value}:${tag}`, idempotencyKey: `wallet-credit:v1:${tag}:${value}` }))));
  const afterDistinct = await db.walletAccount.findUniqueOrThrow({ where: { id: beforeDistinct.id } }); assert(afterDistinct.availableBalance.equals(beforeDistinct.availableBalance.add(6))); assert.equal(afterDistinct.version, beforeDistinct.version + 2);
  await assert.rejects(db.walletAccount.create({ data: { userId: owner.id, currency: "TRY" } }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");

  await db.walletAccount.update({ where: { id: afterDistinct.id }, data: { status: "FROZEN" } });
  await db.$transaction(tx => creditWallet(tx, { ...creditInput, sourceReference: `frozen:${tag}`, idempotencyKey: `wallet-credit:v1:${tag}:frozen` }));
  const closedUser = await user("closed"); await db.walletAccount.create({ data: { userId: closedUser.id, currency: "TRY", status: "CLOSED" } });
  await assert.rejects(db.$transaction(tx => creditWallet(tx, { ...creditInput, userId: closedUser.id, sourceReference: `closed:${tag}`, idempotencyKey: `wallet-credit:v1:${tag}:closed` })), isCode("WALLET_CLOSED"));

  const voidRaceCard = await issued(owner.id, "20.00", `${tag}:void-race`); await activate(voidRaceCard, `${tag}:void-race`);
  const voidRace = await Promise.allSettled([db.$transaction(tx => claimGiftCard(tx, { rawCode: voidRaceCard.rawCode!, userId: owner.id, hmacSecret: secret, effectiveAt: now })), db.$transaction(tx => voidGiftCard(tx, { giftCardId: voidRaceCard.giftCard.id, idempotencyKey: `gift-card-void:v1:${tag}:race`, reason: "QA_RACE", effectiveAt: now }))]);
  assert.equal(voidRace.filter(result => result.status === "fulfilled").length, 1); const voidRaceAfter = await db.giftCard.findUniqueOrThrow({ where: { id: voidRaceCard.giftCard.id } }); assert(["REDEEMED", "VOIDED"].includes(voidRaceAfter.status)); assert.equal(await db.walletTransaction.count({ where: { giftCardId: voidRaceCard.giftCard.id } }), voidRaceAfter.status === "REDEEMED" ? 1 : 0);

  const expiryAt = new Date(now.getTime() + 60_000), expiryCard = await issued(owner.id, "15.00", `${tag}:expiry`, expiryAt); await activate(expiryCard, `${tag}:expiry`);
  const future = new Date(expiryAt.getTime() + 1), expiryRace = await Promise.allSettled([db.$transaction(tx => claimGiftCard(tx, { rawCode: expiryCard.rawCode!, userId: owner.id, hmacSecret: secret, effectiveAt: future })), db.$transaction(tx => expireGiftCard(tx, { giftCardId: expiryCard.giftCard.id, idempotencyKey: `gift-card-expire:v1:${tag}`, reason: "EXPIRED", effectiveAt: future }))]);
  assert.equal(expiryRace.filter(result => result.status === "fulfilled").length, 1); assert.equal((await db.giftCard.findUniqueOrThrow({ where: { id: expiryCard.giftCard.id } })).status, "EXPIRED"); assert.equal(await db.walletTransaction.count({ where: { giftCardId: expiryCard.giftCard.id } }), 0);

  const pendingVoid = await issued(owner.id, "10.00", `${tag}:pending-void`); const voided = await db.$transaction(tx => voidGiftCard(tx, { giftCardId: pendingVoid.giftCard.id, idempotencyKey: `gift-card-void:v1:${tag}:pending`, reason: "PAYMENT_CANCELLED", effectiveAt: now })); assert.equal(voided.giftCard.status, "VOIDED"); assert.equal((await db.$transaction(tx => voidGiftCard(tx, { giftCardId: pendingVoid.giftCard.id, idempotencyKey: `gift-card-void:v1:${tag}:pending`, reason: "PAYMENT_CANCELLED", effectiveAt: now }))).replay, true);

  const issueRollbackPayment = await payment(owner.id, "11.00"), issueRollbackKey = `gift-card-issue:v1:${tag}:rollback`;
  await assert.rejects(db.$transaction(async tx => { await issueGiftCard(tx, { purchaserUserId: owner.id, purchasePaymentId: issueRollbackPayment.id, amount: "11.00", currency: "TRY", sourceReference: `rollback:${tag}`, idempotencyKey: issueRollbackKey, effectiveAt: now, hmacSecret: secret }); throw new Error("FORCED_ROLLBACK"); }));
  assert.equal(await db.giftCard.count({ where: { issuanceIdempotencyKey: issueRollbackKey } }), 0); assert.equal(await db.giftCardLifecycleEvent.count({ where: { idempotencyKey: { contains: issueRollbackKey } } }), 0);

  const activationRollback = await issued(owner.id, "12.00", `${tag}:activation-rollback`); await db.payment.update({ where: { id: activationRollback.payment.id }, data: { status: "PAID", paidAt: now } });
  await assert.rejects(db.$transaction(async tx => { await activateGiftCard(tx, { giftCardId: activationRollback.giftCard.id, paymentId: activationRollback.payment.id, paymentEventId: `paid:${tag}:rollback`, idempotencyKey: `gift-card-activate:v1:${tag}:rollback`, effectiveAt: now }); throw new Error("FORCED_ROLLBACK"); }));
  assert.equal((await db.giftCard.findUniqueOrThrow({ where: { id: activationRollback.giftCard.id } })).status, "PENDING_PAYMENT"); assert.equal(await db.giftCardLifecycleEvent.count({ where: { giftCardId: activationRollback.giftCard.id, type: "ACTIVATED" } }), 0);

  const claimRollback = await issued(owner.id, "13.00", `${tag}:claim-rollback`); await activate(claimRollback, `${tag}:claim-rollback`); const beforeClaimRollback = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: owner.id, currency: "TRY" } } });
  await assert.rejects(db.$transaction(async tx => { await claimGiftCard(tx, { rawCode: claimRollback.rawCode!, userId: owner.id, hmacSecret: secret, effectiveAt: now }); throw new Error("FORCED_ROLLBACK"); }));
  const afterClaimRollback = await db.walletAccount.findUniqueOrThrow({ where: { id: beforeClaimRollback.id } }); assert.equal((await db.giftCard.findUniqueOrThrow({ where: { id: claimRollback.giftCard.id } })).status, "ACTIVE"); assert(afterClaimRollback.availableBalance.equals(beforeClaimRollback.availableBalance)); assert.equal(afterClaimRollback.version, beforeClaimRollback.version); assert.equal(await db.walletTransaction.count({ where: { giftCardId: claimRollback.giftCard.id } }), 0);

  const creditRollbackKey = `wallet-credit:v1:${tag}:rollback`, beforeCreditRollback = await db.walletAccount.findUniqueOrThrow({ where: { id: beforeClaimRollback.id } });
  await assert.rejects(db.$transaction(async tx => { await creditWallet(tx, { ...creditInput, sourceReference: `credit-rollback:${tag}`, idempotencyKey: creditRollbackKey }); throw new Error("FORCED_ROLLBACK"); }));
  const afterCreditRollback = await db.walletAccount.findUniqueOrThrow({ where: { id: beforeClaimRollback.id } }); assert(afterCreditRollback.availableBalance.equals(beforeCreditRollback.availableBalance)); assert.equal(afterCreditRollback.version, beforeCreditRollback.version); assert.equal(await db.walletTransaction.count({ where: { idempotencyKey: creditRollbackKey } }), 0);

  const account = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: owner.id, currency: "TRY" } } });
  const sum = await db.walletTransaction.aggregate({ where: { walletAccountId: account.id, type: { in: ["CREDIT", "GIFT_CARD_CLAIM_CREDIT", "REFUND_CREDIT", "MANUAL_CREDIT"] } }, _sum: { amount: true } }); assert(sum._sum.amount?.equals(account.availableBalance));
  assert.equal(await db.giftCardLifecycleEvent.count({ where: { giftCardId: first.giftCard.id } }), 3);
  console.log("PASS: guarded TEST wallet/gift-card issue, activation, claim, semantic replay, isolation, CAS concurrency, terminal races, rollback, provenance and balance truth");
}

main().finally(async () => {
  await db.giftCardLifecycleEvent.deleteMany({ where: { giftCardId: { in: ids.cards } } });
  await db.walletTransaction.deleteMany({ where: { userId: { in: ids.users } } });
  await db.giftCard.deleteMany({ where: { id: { in: ids.cards } } });
  await db.walletAccount.deleteMany({ where: { userId: { in: ids.users } } });
  await db.payment.deleteMany({ where: { id: { in: ids.payments } } });
  await db.order.deleteMany({ where: { id: { in: ids.orders } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  console.log("PASS: exact cleanup"); await db.$disconnect();
});
