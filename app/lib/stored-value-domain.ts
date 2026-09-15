import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { Prisma, type WalletFundingSource } from "@prisma/client";

export const STORED_VALUE_CURRENCY = "TRY" as const;
export const STORED_VALUE_MAX = new Prisma.Decimal("1000000.00");

export type StoredValueErrorCode =
  | "STORED_VALUE_INVALID_AMOUNT"
  | "STORED_VALUE_UNSUPPORTED_CURRENCY"
  | "STORED_VALUE_INVALID_IDEMPOTENCY"
  | "STORED_VALUE_IDEMPOTENCY_CONFLICT"
  | "WALLET_CLOSED"
  | "WALLET_SPENDING_BLOCKED"
  | "WALLET_STATE_CHANGED"
  | "STORED_VALUE_OWNERSHIP_REQUIRED"
  | "STORED_VALUE_LIFECYCLE_CONFLICT"
  | "STORED_VALUE_PROVENANCE_MISMATCH"
  | "GIFT_CARD_INVALID"
  | "GIFT_CARD_PAYMENT_MISMATCH"
  | "GIFT_CARD_NOT_ACTIVATABLE"
  | "GIFT_CARD_NOT_CLAIMABLE"
  | "GIFT_CARD_NOT_VOIDABLE"
  | "GIFT_CARD_NOT_EXPIRED"
  | "GIFT_CARD_CLAIM_CONFLICT";

export class StoredValueDomainError extends Error {
  constructor(public readonly code: StoredValueErrorCode) { super(code); this.name = "StoredValueDomainError"; }
}

export function storedValueMoney(value: Prisma.Decimal | string) {
  if (typeof value !== "string" && !(value instanceof Prisma.Decimal)) throw new StoredValueDomainError("STORED_VALUE_INVALID_AMOUNT");
  let amount: Prisma.Decimal;
  try { amount = new Prisma.Decimal(value); } catch { throw new StoredValueDomainError("STORED_VALUE_INVALID_AMOUNT"); }
  if (!amount.isFinite() || amount.lte(0) || amount.gt(STORED_VALUE_MAX) || amount.decimalPlaces() > 2) throw new StoredValueDomainError("STORED_VALUE_INVALID_AMOUNT");
  return amount.toDecimalPlaces(2);
}

export function storedValueCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (currency !== STORED_VALUE_CURRENCY) throw new StoredValueDomainError("STORED_VALUE_UNSUPPORTED_CURRENCY");
  return currency;
}

export function validateStoredValueKey(value: string) {
  const key = value.trim();
  if (!key || key.length > 191) throw new StoredValueDomainError("STORED_VALUE_INVALID_IDEMPOTENCY");
  return key;
}

export function semanticHash(value: Readonly<Record<string, unknown>>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function generateGiftCardCode() {
  const compact = randomBytes(20).toString("hex").toUpperCase();
  return compact.match(/.{1,5}/g)!.join("-");
}

export function normalizeGiftCardCode(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-F0-9]{40}$/.test(normalized)) throw new StoredValueDomainError("GIFT_CARD_INVALID");
  return normalized;
}

export function giftCardDigest(rawCode: string, secret: string) {
  if (secret.length < 32) throw new Error("GIFT_CARD_HMAC_SECRET_REQUIRED");
  return createHmac("sha256", secret).update(normalizeGiftCardCode(rawCode)).digest("hex");
}

export function giftCardMask(rawCode: string) {
  return normalizeGiftCardCode(rawCode).slice(-4);
}

export function fundingSource(value: WalletFundingSource) { return value; }
