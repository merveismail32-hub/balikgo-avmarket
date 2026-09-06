import "server-only";
import { Prisma } from "@prisma/client";

export const COMMISSION_DEFAULT_FALLBACK = "0.10" as const;

export function parseCommissionRate(raw: string) {
  if (!/^0(\.\d{1,4})?$|^1(\.0{1,4})?$/.test(raw)) throw new Error("MARKETPLACE_COMMISSION_RATE must be between 0 and 1 with at most four decimals.");
  return new Prisma.Decimal(raw);
}

function configuredRate() {
  return parseCommissionRate(process.env.MARKETPLACE_COMMISSION_RATE ?? COMMISSION_DEFAULT_FALLBACK);
}

export const DEFAULT_COMMISSION_RATE = configuredRate();

// sellerId parametresi, ileride satıcı bazlı server-side policy eklenebilmesi için sınır oluşturur.
export function commissionRateForSeller(sellerId: string) { void sellerId; return DEFAULT_COMMISSION_RATE; }

export function commissionFor(unitPrice: Prisma.Decimal, quantity: number, rate: Prisma.Decimal = DEFAULT_COMMISSION_RATE) {
  const gross = unitPrice.mul(quantity).toDecimalPlaces(2);
  const commission = gross.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { gross, commission, net: gross.minus(commission).toDecimalPlaces(2), rate };
}
