import type { Prisma } from "@prisma/client";

// Nullable legacy relations remain public; linked category/brand records must be active.
export const publicProductPolicy: Prisma.ProductWhereInput = {
  active: true, moderationStatus: "APPROVED", seller: { status: "APPROVED" },
  AND: [{ OR: [{ categoryId: null }, { categoryRecord: { active: true } }] }, { OR: [{ brandId: null }, { brandRecord: { active: true } }] }],
};
