import "server-only";

import { Prisma, type GiftCardStatus, type WalletFundingSource, type WalletTransactionType } from "@prisma/client";
import { generateGiftCardCode, giftCardDigest, giftCardMask, semanticHash, storedValueCurrency, storedValueMoney, StoredValueDomainError, validateStoredValueKey } from "./stored-value-domain";

type Tx = Prisma.TransactionClient;
type Money = Prisma.Decimal | string;

function sameHash(existing: { semanticHash: string }, expected: string) {
  if (existing.semanticHash !== expected) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT");
}

async function lockUser(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  if (!rows.length) throw new StoredValueDomainError("GIFT_CARD_INVALID");
}

async function walletForUpdate(tx: Tx, userId: string, currency: string) {
  await lockUser(tx, userId);
  let account = await tx.walletAccount.findUnique({ where: { userId_currency: { userId, currency } } });
  if (!account) account = await tx.walletAccount.create({ data: { userId, currency } });
  await tx.$queryRaw`SELECT id FROM "WalletAccount" WHERE id = ${account.id} FOR UPDATE`;
  return tx.walletAccount.findUniqueOrThrow({ where: { id: account.id } });
}

export async function creditWallet(tx: Tx, input: Readonly<{
  userId: string; amount: Money; currency: string; fundingSource: WalletFundingSource;
  sourceType: string; sourceReference: string; idempotencyKey: string; correlationId?: string;
  reason: string; actorUserId?: string; giftCardId?: string; orderId?: string; paymentId?: string; refundId?: string; effectiveAt: Date;
}>) {
  const amount = storedValueMoney(input.amount), currency = storedValueCurrency(input.currency), key = validateStoredValueKey(input.idempotencyKey);
  if (!input.sourceType.trim() || !input.sourceReference.trim() || !input.reason.trim() || !Number.isFinite(input.effectiveAt.getTime())) throw new StoredValueDomainError("STORED_VALUE_INVALID_IDEMPOTENCY");
  const hash = semanticHash({ userId: input.userId, amount: amount.toFixed(2), currency, fundingSource: input.fundingSource, sourceType: input.sourceType.trim(), sourceReference: input.sourceReference.trim(), giftCardId: input.giftCardId ?? null, orderId: input.orderId ?? null, paymentId: input.paymentId ?? null, refundId: input.refundId ?? null, reason: input.reason.trim(), actorUserId: input.actorUserId ?? null });
  const account = await walletForUpdate(tx, input.userId, currency);
  const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: key } });
  if (existing) { sameHash(existing, hash); if (existing.userId !== input.userId || existing.walletAccountId !== account.id) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT"); return { account, transaction: existing, replay: true as const }; }
  if (account.status === "CLOSED") throw new StoredValueDomainError("WALLET_CLOSED");
  const after = account.availableBalance.add(amount);
  const changed = await tx.walletAccount.updateMany({ where: { id: account.id, version: account.version }, data: { availableBalance: after, version: { increment: 1 } } });
  if (changed.count !== 1) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  const type: WalletTransactionType = input.giftCardId ? "GIFT_CARD_CLAIM_CREDIT" : "CREDIT";
  const transaction = await tx.walletTransaction.create({ data: { walletAccountId: account.id, userId: input.userId, amount, currency, type, fundingSource: input.fundingSource, sourceType: input.sourceType.trim(), sourceReference: input.sourceReference.trim(), giftCardId: input.giftCardId, orderId: input.orderId, paymentId: input.paymentId, refundId: input.refundId, availableBalanceBefore: account.availableBalance, availableBalanceAfter: after, reservedBalanceBefore: account.reservedBalance, reservedBalanceAfter: account.reservedBalance, accountVersionBefore: account.version, accountVersionAfter: account.version + 1, idempotencyKey: key, semanticHash: hash, correlationId: input.correlationId, reason: input.reason.trim(), actorUserId: input.actorUserId, effectiveAt: input.effectiveAt } });
  return { account: await tx.walletAccount.findUniqueOrThrow({ where: { id: account.id } }), transaction, replay: false as const };
}

export async function reserveWalletForCheckout(tx: Tx, input: Readonly<{ userId: string; orderId: string; paymentId: string; payable: Money; currency: string; idempotencyKey: string; effectiveAt: Date; requestedAmount?: Money; }>) {
  const payable = storedValueMoney(input.payable), currency = storedValueCurrency(input.currency), key = validateStoredValueKey(input.idempotencyKey);
  const ownership = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { order: { select: { userId: true, id: true } } } });
  if (!ownership || ownership.order.id !== input.orderId || ownership.order.userId !== input.userId) throw new StoredValueDomainError("STORED_VALUE_OWNERSHIP_REQUIRED");
  const hash = semanticHash({ userId: input.userId, orderId: input.orderId, paymentId: input.paymentId, payable: payable.toFixed(2), currency, requestedAmount: input.requestedAmount ? storedValueMoney(input.requestedAmount).toFixed(2) : null });
  const account = await walletForUpdate(tx, input.userId, currency);
  const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: key } });
  if (existing) { sameHash(existing, hash); if (existing.userId !== input.userId || existing.orderId !== input.orderId || existing.paymentId !== input.paymentId) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT"); return { transaction: existing, walletTender: existing.amount, externalTender: payable.minus(existing.amount), replay: true as const }; }
  if (account.status !== "ACTIVE") throw new StoredValueDomainError("WALLET_SPENDING_BLOCKED");
  const requested = input.requestedAmount ? storedValueMoney(input.requestedAmount) : payable;
  const amount = Prisma.Decimal.min(payable, Prisma.Decimal.min(account.availableBalance, requested));
  if (amount.lte(0)) return { transaction: null, walletTender: new Prisma.Decimal(0), externalTender: payable, replay: false as const };
  const afterAvailable = account.availableBalance.minus(amount), afterReserved = account.reservedBalance.add(amount);
  const changed = await tx.walletAccount.updateMany({ where: { id: account.id, version: account.version, availableBalance: { gte: amount } }, data: { availableBalance: afterAvailable, reservedBalance: afterReserved, version: { increment: 1 } } });
  if (changed.count !== 1) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  const transaction = await tx.walletTransaction.create({ data: { walletAccountId: account.id, userId: input.userId, amount, currency, type: "DEBIT_RESERVED", fundingSource: "CUSTOMER_WALLET_TENDER", sourceType: "ORDER_CHECKOUT", sourceReference: input.orderId, orderId: input.orderId, paymentId: input.paymentId, availableBalanceBefore: account.availableBalance, availableBalanceAfter: afterAvailable, reservedBalanceBefore: account.reservedBalance, reservedBalanceAfter: afterReserved, accountVersionBefore: account.version, accountVersionAfter: account.version + 1, idempotencyKey: key, semanticHash: hash, correlationId: input.orderId, reason: "WALLET_CHECKOUT_RESERVATION", effectiveAt: input.effectiveAt } });
  return { transaction, walletTender: amount, externalTender: payable.minus(amount), replay: false as const };
}

export async function issueGiftCard(tx: Tx, input: Readonly<{
  purchaserUserId: string; purchasePaymentId: string; amount: Money; currency: string;
  sourceReference: string; idempotencyKey: string; correlationId?: string; expiresAt?: Date;
  effectiveAt: Date; hmacSecret: string;
}>) {
  const amount = storedValueMoney(input.amount), currency = storedValueCurrency(input.currency), key = validateStoredValueKey(input.idempotencyKey);
  if (!input.sourceReference.trim() || !Number.isFinite(input.effectiveAt.getTime()) || (input.expiresAt && input.expiresAt <= input.effectiveAt)) throw new StoredValueDomainError("GIFT_CARD_INVALID");
  await lockUser(tx, input.purchaserUserId);
  const hash = semanticHash({ purchaserUserId: input.purchaserUserId, purchasePaymentId: input.purchasePaymentId, amount: amount.toFixed(2), currency, sourceReference: input.sourceReference.trim(), expiresAt: input.expiresAt?.toISOString() ?? null });
  const replay = await tx.giftCard.findUnique({ where: { issuanceIdempotencyKey: key } });
  if (replay) { if (replay.issuanceSemanticHash !== hash || replay.purchaserUserId !== input.purchaserUserId) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT"); return { giftCard: replay, rawCode: null, replay: true as const }; }
  const payment = await tx.payment.findUnique({ where: { id: input.purchasePaymentId }, select: { id: true, amount: true, currency: true, order: { select: { userId: true } } } });
  if (!payment || payment.order.userId !== input.purchaserUserId || !payment.amount.equals(amount) || payment.currency !== currency) throw new StoredValueDomainError("GIFT_CARD_PAYMENT_MISMATCH");
  const rawCode = generateGiftCardCode(), digest = giftCardDigest(rawCode, input.hmacSecret);
  const giftCard = await tx.giftCard.create({ data: { currency, issuedAmount: amount, remainingAmount: amount, fundingSource: "PURCHASED_GIFT_CARD", sourceReference: input.sourceReference.trim(), codeDigest: digest, maskedSuffix: giftCardMask(rawCode), purchasePaymentId: payment.id, purchaserUserId: input.purchaserUserId, expiresAt: input.expiresAt, issuanceIdempotencyKey: key, issuanceSemanticHash: hash } });
  await tx.giftCardLifecycleEvent.create({ data: { giftCardId: giftCard.id, type: "ISSUED", toStatus: "PENDING_PAYMENT", amount, currency, paymentReference: payment.id, userId: input.purchaserUserId, idempotencyKey: `gift-card-event:v1:issued:${giftCard.id}`, semanticHash: hash, correlationId: input.correlationId, reason: "PURCHASED_GIFT_CARD_ISSUED", effectiveAt: input.effectiveAt } });
  return { giftCard, rawCode, replay: false as const };
}

export async function activateGiftCard(tx: Tx, input: Readonly<{ giftCardId: string; paymentId: string; paymentEventId: string; idempotencyKey: string; effectiveAt: Date }>) {
  const key = validateStoredValueKey(input.idempotencyKey);
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.paymentId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "GiftCard" WHERE id = ${input.giftCardId} FOR UPDATE`;
  const card = await tx.giftCard.findUnique({ where: { id: input.giftCardId } });
  const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
  if (!card || !payment || card.purchasePaymentId !== payment.id || payment.status !== "PAID" || !payment.amount.equals(card.issuedAmount) || payment.currency !== card.currency) throw new StoredValueDomainError("GIFT_CARD_PAYMENT_MISMATCH");
  const hash = semanticHash({ giftCardId: card.id, paymentId: payment.id, paymentEventId: input.paymentEventId, amount: card.issuedAmount.toFixed(2), currency: card.currency });
  const event = await tx.giftCardLifecycleEvent.findUnique({ where: { idempotencyKey: key } });
  if (event) { sameHash(event, hash); return { giftCard: card, event, replay: true as const }; }
  if (card.status === "ACTIVE") return { giftCard: card, event: null, replay: true as const };
  if (card.status !== "PENDING_PAYMENT") throw new StoredValueDomainError("GIFT_CARD_NOT_ACTIVATABLE");
  const changed = await tx.giftCard.updateMany({ where: { id: card.id, status: "PENDING_PAYMENT", version: card.version }, data: { status: "ACTIVE", activatedAt: input.effectiveAt, version: { increment: 1 } } });
  if (changed.count !== 1) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  const created = await tx.giftCardLifecycleEvent.create({ data: { giftCardId: card.id, type: "ACTIVATED", fromStatus: "PENDING_PAYMENT", toStatus: "ACTIVE", amount: card.issuedAmount, currency: card.currency, paymentReference: payment.id, userId: card.purchaserUserId, idempotencyKey: key, semanticHash: hash, correlationId: input.paymentEventId, reason: "PAYMENT_SUCCEEDED", effectiveAt: input.effectiveAt } });
  return { giftCard: await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } }), event: created, replay: false as const };
}

export async function claimGiftCard(tx: Tx, input: Readonly<{ rawCode: string; userId: string; hmacSecret: string; correlationId?: string; effectiveAt: Date }>) {
  const digest = giftCardDigest(input.rawCode, input.hmacSecret);
  const identity = await tx.giftCard.findUnique({ where: { codeDigest: digest }, select: { id: true } });
  if (!identity) throw new StoredValueDomainError("GIFT_CARD_INVALID");
  await tx.$queryRaw`SELECT id FROM "GiftCard" WHERE id = ${identity.id} FOR UPDATE`;
  const card = await tx.giftCard.findUniqueOrThrow({ where: { id: identity.id } });
  if (card.status === "REDEEMED") {
    if (card.claimedByUserId !== input.userId) throw new StoredValueDomainError("GIFT_CARD_CLAIM_CONFLICT");
    const transaction = await tx.walletTransaction.findFirstOrThrow({ where: { giftCardId: card.id, type: "GIFT_CARD_CLAIM_CREDIT" } });
    return { giftCard: card, transaction, replay: true as const };
  }
  if (card.status !== "ACTIVE" || card.remainingAmount.lte(0) || (card.expiresAt && card.expiresAt <= input.effectiveAt)) throw new StoredValueDomainError("GIFT_CARD_NOT_CLAIMABLE");
  const credit = await creditWallet(tx, { userId: input.userId, amount: card.remainingAmount, currency: card.currency, fundingSource: card.fundingSource, sourceType: "GIFT_CARD", sourceReference: card.id, giftCardId: card.id, idempotencyKey: `wallet-credit:v1:gift-card:${card.id}`, correlationId: input.correlationId, reason: "GIFT_CARD_CLAIM", effectiveAt: input.effectiveAt });
  const changed = await tx.giftCard.updateMany({ where: { id: card.id, status: "ACTIVE", version: card.version, remainingAmount: card.remainingAmount }, data: { status: "REDEEMED", remainingAmount: 0, claimedAt: input.effectiveAt, claimedByUserId: input.userId, version: { increment: 1 } } });
  if (changed.count !== 1) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  const hash = semanticHash({ giftCardId: card.id, userId: input.userId, amount: card.remainingAmount.toFixed(2), currency: card.currency });
  await tx.giftCardLifecycleEvent.create({ data: { giftCardId: card.id, type: "CLAIMED", fromStatus: "ACTIVE", toStatus: "REDEEMED", amount: card.remainingAmount, currency: card.currency, paymentReference: card.purchasePaymentId, userId: input.userId, idempotencyKey: `gift-card-claim:v1:${card.id}:${input.userId}`, semanticHash: hash, correlationId: input.correlationId, reason: "CLAIMED_TO_WALLET", effectiveAt: input.effectiveAt } });
  return { giftCard: await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } }), transaction: credit.transaction, replay: false as const };
}

async function terminateGiftCard(tx: Tx, input: Readonly<{ giftCardId: string; target: "VOIDED" | "EXPIRED"; idempotencyKey: string; reason: string; actorUserId?: string; effectiveAt: Date }>) {
  const key = validateStoredValueKey(input.idempotencyKey);
  await tx.$queryRaw`SELECT id FROM "GiftCard" WHERE id = ${input.giftCardId} FOR UPDATE`;
  const card = await tx.giftCard.findUnique({ where: { id: input.giftCardId } });
  if (!card) throw new StoredValueDomainError("GIFT_CARD_INVALID");
  const replay = await tx.giftCardLifecycleEvent.findUnique({ where: { idempotencyKey: key } });
  if (replay) {
    if (replay.giftCardId !== card.id || replay.toStatus !== input.target || replay.reason !== input.reason.trim()) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT");
    return { giftCard: card, event: replay, replay: true as const };
  }
  if (input.target === "VOIDED" && !["PENDING_PAYMENT", "ACTIVE"].includes(card.status)) throw new StoredValueDomainError("GIFT_CARD_NOT_VOIDABLE");
  if (input.target === "EXPIRED" && (card.status !== "ACTIVE" || !card.expiresAt || card.expiresAt > input.effectiveAt)) throw new StoredValueDomainError("GIFT_CARD_NOT_EXPIRED");
  const fromStatus = card.status as GiftCardStatus, amount = card.remainingAmount;
  const hash = semanticHash({ giftCardId: card.id, target: input.target, amount: amount.toFixed(2), reason: input.reason.trim() });
  const changed = await tx.giftCard.updateMany({ where: { id: card.id, status: fromStatus, version: card.version }, data: { status: input.target, remainingAmount: 0, ...(input.target === "VOIDED" ? { voidedAt: input.effectiveAt } : {}), version: { increment: 1 } } });
  if (changed.count !== 1) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  const event = await tx.giftCardLifecycleEvent.create({ data: { giftCardId: card.id, type: input.target, fromStatus, toStatus: input.target, amount, currency: card.currency, paymentReference: card.purchasePaymentId, userId: card.purchaserUserId, idempotencyKey: key, semanticHash: hash, reason: input.reason.trim(), actorUserId: input.actorUserId, effectiveAt: input.effectiveAt } });
  return { giftCard: await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } }), event, replay: false as const };
}

export const voidGiftCard = (tx: Tx, input: Readonly<{ giftCardId: string; idempotencyKey: string; reason: string; actorUserId?: string; effectiveAt: Date }>) => terminateGiftCard(tx, { ...input, target: "VOIDED" });
export const expireGiftCard = (tx: Tx, input: Readonly<{ giftCardId: string; idempotencyKey: string; reason: string; effectiveAt: Date }>) => terminateGiftCard(tx, { ...input, target: "EXPIRED" });
