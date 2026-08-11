import "server-only";

import { Prisma } from "@prisma/client";

export const duplicateSkuMessage = "Bu SKU kodu mağazanızdaki başka bir üründe zaten kullanılıyor.";

export function isDuplicateSellerSkuError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;

  const metadata = JSON.stringify(error.meta ?? "");
  return metadata.includes("Product_sellerId_sku_key") || (metadata.includes("sellerId") && metadata.includes("sku"));
}

export function isProductSlugUniqueError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const metadata = JSON.stringify(error.meta ?? "");
  return metadata.includes("Product_slug_key") || metadata.includes('"slug"');
}
