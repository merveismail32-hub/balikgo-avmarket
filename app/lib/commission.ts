import "server-only";
import { Prisma } from "@prisma/client";
export const DEFAULT_COMMISSION_RATE = new Prisma.Decimal("0.10");
export function commissionFor(unitPrice: Prisma.Decimal, quantity: number, rate: Prisma.Decimal = DEFAULT_COMMISSION_RATE) { const gross = unitPrice.mul(quantity); const commission = gross.mul(rate).toDecimalPlaces(2); return { gross, commission, net: gross.minus(commission), rate }; }
