import "server-only";

import { Prisma, type SellerOnboardingStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { assertSubmissionComplete, nextReviewStatus, requiredDocumentTypes, SellerOnboardingError, type SellerOnboardingDraftInput, type SellerOnboardingReviewAction } from "./seller-onboarding-domain";
export { sellerOnboardingDraftSchema, SellerOnboardingError } from "./seller-onboarding-domain";

const editableStatuses: SellerOnboardingStatus[] = ["DRAFT", "NEEDS_REVISION"];
function slugify(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const sellerSafeSelect = {
  id: true, storeName: true, legalName: true, companyType: true, phone: true, taxNumber: true, taxOffice: true,
  city: true, address: true, description: true, categories: true, onboardingStatus: true, revisionReason: true,
  submittedAt: true, reviewedAt: true, approvedAt: true, activationEligible: true, onboardingVersion: true,
  authorizedPersonName: true, authorizedPersonSurname: true, authorizedPersonEmail: true, authorizedPersonTitle: true,
  kybDocuments: { select: { id: true, type: true, reference: true, fileName: true, status: true, providedAt: true } },
} satisfies Prisma.SellerProfileSelect;

export async function getOwnSellerOnboarding(userId: string) {
  return prisma.sellerProfile.findUnique({ where: { userId }, select: sellerSafeSelect });
}

export async function saveAndSubmitSellerOnboarding(input: { userId: string; data: SellerOnboardingDraftInput; idempotencyKey: string }) {
  assertSubmissionComplete(input.data);
  return prisma.$transaction(async (tx) => {
    const replay = await tx.sellerOnboardingEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { sellerId: true } });
    if (replay) {
      const owned = await tx.sellerProfile.findFirst({ where: { id: replay.sellerId, userId: input.userId }, select: sellerSafeSelect });
      if (!owned) throw new SellerOnboardingError("FORBIDDEN", "Başvuru erişimi reddedildi.");
      return owned;
    }
    const existing = await tx.sellerProfile.findUnique({ where: { userId: input.userId }, select: { id: true, onboardingStatus: true, onboardingVersion: true } });
    if (existing && !editableStatuses.includes(existing.onboardingStatus)) {
      if (["SUBMITTED", "UNDER_REVIEW"].includes(existing.onboardingStatus)) {
        return tx.sellerProfile.findUniqueOrThrow({ where: { id: existing.id }, select: sellerSafeSelect });
      }
      throw new SellerOnboardingError("INVALID_STATE", "Bu başvuru artık değiştirilemez.");
    }
    const { acceptedTerms, documents, ...data } = input.data;
    void acceptedTerms;
    const now = new Date();
    const profile = existing
      ? await tx.sellerProfile.update({ where: { id: existing.id }, data: { ...data, termsAcceptedAt: now } })
      : await tx.sellerProfile.create({ data: { userId: input.userId, ...data, storeSlug: `${slugify(data.storeName) || "magaza"}-${input.userId.slice(-6).toLowerCase()}`, termsAcceptedAt: now } });
    await Promise.all(documents.map((document) => tx.sellerKybDocument.upsert({
      where: { sellerId_type: { sellerId: profile.id, type: document.type } },
      create: { sellerId: profile.id, ...document },
      update: { reference: document.reference, fileName: document.fileName, status: "PROVIDED", reviewNote: null, reviewedAt: null, providedAt: now },
    })));
    const transitioned = await tx.sellerProfile.updateMany({
      where: { id: profile.id, onboardingVersion: existing?.onboardingVersion ?? 0, onboardingStatus: { in: editableStatuses } },
      data: { onboardingStatus: "SUBMITTED", submittedAt: now, reviewedAt: null, reviewerUserId: null, revisionReason: null, activationEligible: false, onboardingVersion: { increment: 1 } },
    });
    if (transitioned.count !== 1) throw new SellerOnboardingError("CONFLICT", "Başvuru eşzamanlı olarak değiştirildi; güncel durumu yükleyin.");
    await tx.sellerFinancialIdentity.updateMany({ where: { sellerId: profile.id }, data: { holdActive: true, holdReasonCode: "TAX_VERIFICATION_REQUIRED", holdSetAt: now, holdReleasedAt: null, coordinationVersion: { increment: 1 } } });
    await tx.user.update({ where: { id: input.userId }, data: { phone: data.phone } });
    await tx.sellerOnboardingEvent.create({ data: { sellerId: profile.id, actorUserId: input.userId, action: existing?.onboardingStatus === "NEEDS_REVISION" ? "RESUBMITTED" : "SUBMITTED", fromStatus: existing?.onboardingStatus ?? "DRAFT", toStatus: "SUBMITTED", idempotencyKey: input.idempotencyKey } });
    return tx.sellerProfile.findUniqueOrThrow({ where: { id: profile.id }, select: sellerSafeSelect });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewSellerOnboarding(input: { sellerId: string; reviewerUserId: string; action: SellerOnboardingReviewAction; reason?: string; idempotencyKey: string }) {
  if ((input.action === "REQUEST_REVISION" || input.action === "REJECT") && (!input.reason || input.reason.trim().length < 2)) throw new SellerOnboardingError("INCOMPLETE", "İşlem nedeni zorunludur.");
  return prisma.$transaction(async (tx) => {
    const replay = await tx.sellerOnboardingEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { sellerId: true, toStatus: true } });
    if (replay) {
      if (replay.sellerId !== input.sellerId) throw new SellerOnboardingError("CONFLICT", "Idempotency anahtarı başka bir işleme ait.");
      return tx.sellerProfile.findUniqueOrThrow({ where: { id: input.sellerId }, select: { id: true, onboardingStatus: true, activationEligible: true } });
    }
    const reviewer = await tx.user.findUnique({ where: { id: input.reviewerUserId }, select: { role: true } });
    if (reviewer?.role !== "ADMIN") throw new SellerOnboardingError("FORBIDDEN", "Yönetici yetkisi gerekli.");
    const current = await tx.sellerProfile.findUnique({ where: { id: input.sellerId }, select: { userId: true, onboardingStatus: true, onboardingVersion: true, storeName: true, legalName: true, taxNumber: true, taxOffice: true, authorizedPersonName: true, authorizedPersonSurname: true, authorizedPersonEmail: true, authorizedPersonTitle: true, kybDocuments: { select: { type: true, status: true } } } });
    if (!current) throw new SellerOnboardingError("NOT_FOUND", "Başvuru bulunamadı.");
    if (current.userId === input.reviewerUserId) throw new SellerOnboardingError("FORBIDDEN", "Kendi başvurunuzu inceleyemezsiniz.");
    const target = nextReviewStatus(current.onboardingStatus, input.action);
    if (target === "APPROVED") {
      const values = [current.storeName, current.legalName, current.taxNumber, current.taxOffice, current.authorizedPersonName, current.authorizedPersonSurname, current.authorizedPersonEmail, current.authorizedPersonTitle];
      const acceptedTypes = new Set(current.kybDocuments.filter((document) => document.status !== "REJECTED").map((document) => document.type));
      if (values.some((value) => !value.trim()) || requiredDocumentTypes.some((type) => !acceptedTypes.has(type))) throw new SellerOnboardingError("INCOMPLETE", "Zorunlu KYB bilgileri ve belgeleri tamamlanmadan onay verilemez.");
    }
    if (target === current.onboardingStatus) return { id: input.sellerId, onboardingStatus: target, activationEligible: target === "APPROVED" };
    const now = new Date();
    const changed = await tx.sellerProfile.updateMany({
      where: { id: input.sellerId, onboardingStatus: current.onboardingStatus, onboardingVersion: current.onboardingVersion },
      data: {
        onboardingStatus: target, onboardingVersion: { increment: 1 }, reviewerUserId: input.reviewerUserId, reviewedAt: now,
        approvedAt: target === "APPROVED" ? now : null, activationEligible: target === "APPROVED",
        revisionReason: target === "NEEDS_REVISION" ? input.reason!.trim() : null,
        rejectionReason: target === "REJECTED" ? input.reason!.trim() : null,
      },
    });
    if (changed.count !== 1) throw new SellerOnboardingError("CONFLICT", "Başvuru başka bir inceleyici tarafından değiştirildi.");
    await tx.sellerFinancialIdentity.updateMany({ where: { sellerId: input.sellerId }, data: { holdActive: true, holdReasonCode: "TAX_VERIFICATION_REQUIRED", holdSetAt: now, holdReleasedAt: null, coordinationVersion: { increment: 1 } } });
    await tx.sellerOnboardingEvent.create({ data: { sellerId: input.sellerId, actorUserId: input.reviewerUserId, action: input.action, fromStatus: current.onboardingStatus, toStatus: target, reason: input.reason?.trim(), idempotencyKey: input.idempotencyKey } });
    return { id: input.sellerId, onboardingStatus: target, activationEligible: target === "APPROVED" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getAdminSellerOnboarding(sellerId: string) {
  return prisma.sellerProfile.findUnique({ where: { id: sellerId }, include: { user: { select: { id: true, name: true, surname: true, email: true, phone: true } }, kybDocuments: true, onboardingEvents: { orderBy: { createdAt: "desc" } } } });
}
