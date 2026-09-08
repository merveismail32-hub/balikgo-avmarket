import type { Prisma } from "@prisma/client";

export const publishableSellerOfferPolicy = { priceAnomalyHeld: false } satisfies Prisma.SellerOfferWhereInput;

export function isSellerOfferPublicationEligible(offer: Readonly<{ priceAnomalyHeld?: boolean }>) {
  return offer.priceAnomalyHeld !== true;
}
