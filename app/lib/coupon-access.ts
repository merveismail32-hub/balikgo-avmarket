import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCampaignAccessCouponAvailable, CouponDomainError, couponLifecycleMutationSchema, createCampaignAccessCouponSchema, normalizeCampaignAccessCode } from "./coupon-domain";

type Client = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;

export type CouponRedemptionInput = Readonly<{ couponCode: unknown; userId: string; orderId: string; idempotencyKey: string; effectiveAt: Date }>;
export type CampaignAccessCouponResolution = Readonly<{ id: string; code: string; campaignId: string; version: number }>;

async function lockCoupon(tx: Tx, couponId: string) {
  await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id = ${couponId} FOR UPDATE`;
}

export async function resolveCampaignAccessCoupon(tx: Tx, input: Readonly<{ couponCode: unknown; userId: string; effectiveAt: Date }>): Promise<CampaignAccessCouponResolution> {
  const code = normalizeCampaignAccessCode(input.couponCode);
  const coupon = await tx.coupon.findUnique({ where: { code }, select: { id: true, code: true, campaignId: true, accessMode: true, lifecycleStatus: true, active: true, validFrom: true, validUntil: true, usageLimit: true, usageCount: true, version: true, perUserLimit: true } });
  if (!coupon) throw new CouponDomainError("COUPON_CODE_INVALID");
  await lockCoupon(tx, coupon.id);
  const current = await tx.coupon.findUniqueOrThrow({ where: { id: coupon.id }, select: { id: true, code: true, campaignId: true, accessMode: true, lifecycleStatus: true, active: true, validFrom: true, validUntil: true, usageLimit: true, usageCount: true, perUserLimit: true, version: true } });
  assertCampaignAccessCouponAvailable({ ...current, usageLimit: current.usageLimit, usageCount: current.usageCount }, input.effectiveAt);
  if (!current.campaignId) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
  const campaign = await tx.campaign.findUnique({ where: { id: current.campaignId }, select: { status: true, effectiveFrom: true, effectiveUntil: true } });
  if (!campaign || campaign.status !== "PUBLISHED" || input.effectiveAt < campaign.effectiveFrom || input.effectiveAt >= campaign.effectiveUntil) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
  const used = await tx.couponRedemption.count({ where: { couponId: current.id, state: { in: ["RESERVED", "CONSUMED"] } } });
  if (current.usageLimit !== null && used >= current.usageLimit) throw new CouponDomainError("COUPON_EXHAUSTED");
  const userUsed = await tx.couponRedemption.count({ where: { couponId: current.id, userId: input.userId, state: { in: ["RESERVED", "CONSUMED"] } } });
  if (userUsed >= current.perUserLimit) throw new CouponDomainError(current.perUserLimit === 1 ? "COUPON_ALREADY_REDEEMED" : "COUPON_USER_LIMIT_REACHED");
  return { id: current.id, code: current.code, campaignId: current.campaignId, version: current.version };
}

function sameRedemption(existing: { couponId: string; userId: string; orderId: string }, input: CouponRedemptionInput, couponId: string) {
  return existing.couponId === couponId && existing.userId === input.userId && existing.orderId === input.orderId;
}

function assertReplay(existing: { couponId: string; userId: string; orderId: string }, input: CouponRedemptionInput, couponId: string, couponCode: string) {
  if (!sameRedemption(existing, input, couponId) || couponCode !== normalizeCampaignAccessCode(input.couponCode)) throw new CouponDomainError("COUPON_IDEMPOTENCY_CONFLICT");
}

export async function reserveCoupon(tx: Tx, input: CouponRedemptionInput) {
  const code = normalizeCampaignAccessCode(input.couponCode);
  if (!input.userId || !input.orderId || !input.idempotencyKey.trim() || input.idempotencyKey.length > 191 || !Number.isFinite(input.effectiveAt.getTime())) throw new CouponDomainError("COUPON_IDEMPOTENCY_CONFLICT");
  const replay = await tx.couponRedemption.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    const replayCoupon = await tx.coupon.findUnique({ where: { id: replay.couponId }, select: { code: true } });
    if (!replayCoupon || normalizeCampaignAccessCode(replayCoupon.code) !== code || !sameRedemption(replay, input, replay.couponId)) throw new CouponDomainError("COUPON_IDEMPOTENCY_CONFLICT");
    return { redemption: replay, replay: true };
  }
  const coupon = await tx.coupon.findUnique({ where: { code }, select: { id: true, campaignId: true, accessMode: true, lifecycleStatus: true, active: true, validFrom: true, validUntil: true, usageLimit: true, usageCount: true, perUserLimit: true, version: true } });
  if (!coupon) throw new CouponDomainError("COUPON_CODE_INVALID");
  await lockCoupon(tx, coupon.id);
  const lockedReplay = await tx.couponRedemption.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (lockedReplay) {
    assertReplay(lockedReplay, input, coupon.id, code);
    return { redemption: lockedReplay, replay: true };
  }
  const current = await tx.coupon.findUniqueOrThrow({ where: { id: coupon.id }, select: { id: true, campaignId: true, accessMode: true, lifecycleStatus: true, active: true, validFrom: true, validUntil: true, usageLimit: true, usageCount: true, perUserLimit: true, version: true } });
  assertCampaignAccessCouponAvailable(current, input.effectiveAt);
  if (!current.campaignId) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
  const campaign = await tx.campaign.findUnique({ where: { id: current.campaignId }, select: { id: true, status: true, effectiveFrom: true, effectiveUntil: true } });
  if (!campaign || campaign.status !== "PUBLISHED" || input.effectiveAt < campaign.effectiveFrom || input.effectiveAt >= campaign.effectiveUntil) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
  const used = await tx.couponRedemption.count({ where: { couponId: current.id, state: { in: ["RESERVED", "CONSUMED"] } } });
  if (current.usageLimit !== null && used >= current.usageLimit) throw new CouponDomainError("COUPON_EXHAUSTED");
  const userUsed = await tx.couponRedemption.count({ where: { couponId: current.id, userId: input.userId, state: { in: ["RESERVED", "CONSUMED"] } } });
  if (userUsed >= current.perUserLimit) throw new CouponDomainError(current.perUserLimit === 1 && userUsed > 0 ? "COUPON_ALREADY_REDEEMED" : "COUPON_USER_LIMIT_REACHED");
  let redemption;
  try {
    redemption = await tx.couponRedemption.create({ data: { couponId: current.id, userId: input.userId, orderId: input.orderId, idempotencyKey: input.idempotencyKey, state: "RESERVED", couponVersion: current.version, campaignId: current.campaignId, discountAmount: 0, consumedAt: null, releasedAt: null } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const target = (error as { meta?: { target?: string[] } }).meta?.target ?? [];
      throw new CouponDomainError(target.includes("idempotencyKey") ? "COUPON_IDEMPOTENCY_CONFLICT" : "COUPON_ALREADY_REDEEMED");
    }
    throw error;
  }
  await tx.coupon.update({ where: { id: current.id }, data: { usageCount: { increment: 1 } } });
  await tx.couponRedemptionAudit.create({ data: { redemptionId: redemption.id, couponId: current.id, campaignId: current.campaignId, userId: input.userId, orderId: input.orderId, idempotencyKey: input.idempotencyKey, previousState: null, nextState: "RESERVED", couponVersion: current.version, reason: "RESERVATION_CREATED" } });
  return { redemption, replay: false };
}

export async function consumeCouponReservation(tx: Tx, input: Readonly<{ redemptionId: string; userId: string; orderId: string }>) {
  await tx.$queryRaw`SELECT id FROM "CouponRedemption" WHERE id = ${input.redemptionId} FOR UPDATE`;
  const current = await tx.couponRedemption.findUnique({ where: { id: input.redemptionId } });
  if (!current || current.userId !== input.userId || current.orderId !== input.orderId) throw new CouponDomainError("COUPON_IDEMPOTENCY_CONFLICT");
  if (current.state === "CONSUMED") return { redemption: current, replay: true };
  if (current.state !== "RESERVED") throw new CouponDomainError("COUPON_STALE_STATE");
  const changed = await tx.couponRedemption.updateMany({ where: { id: current.id, state: "RESERVED", couponVersion: current.couponVersion }, data: { state: "CONSUMED", consumedAt: new Date(), releasedAt: null } });
  if (changed.count !== 1) throw new CouponDomainError("COUPON_STALE_STATE");
  const redemption = await tx.couponRedemption.findUniqueOrThrow({ where: { id: current.id } });
  await tx.couponRedemptionAudit.create({ data: { redemptionId: redemption.id, couponId: redemption.couponId, campaignId: redemption.campaignId, userId: redemption.userId, orderId: redemption.orderId, idempotencyKey: redemption.idempotencyKey, previousState: "RESERVED", nextState: "CONSUMED", couponVersion: redemption.couponVersion, reason: "RESERVATION_CONSUMED" } });
  return { redemption, replay: false };
}

export async function releaseCouponReservation(tx: Tx, input: Readonly<{ redemptionId: string; userId: string; orderId: string; reason?: string }>) {
  await tx.$queryRaw`SELECT id FROM "CouponRedemption" WHERE id = ${input.redemptionId} FOR UPDATE`;
  const current = await tx.couponRedemption.findUnique({ where: { id: input.redemptionId } });
  if (!current || current.userId !== input.userId || current.orderId !== input.orderId) throw new CouponDomainError("COUPON_IDEMPOTENCY_CONFLICT");
  if (current.state === "RELEASED") return { redemption: current, replay: true };
  if (current.state !== "RESERVED") throw new CouponDomainError("COUPON_STALE_STATE");
  await lockCoupon(tx, current.couponId);
  const changed = await tx.couponRedemption.updateMany({ where: { id: current.id, state: "RESERVED", couponVersion: current.couponVersion }, data: { state: "RELEASED", releasedAt: new Date(), consumedAt: null } });
  if (changed.count !== 1) throw new CouponDomainError("COUPON_STALE_STATE");
  const counter = await tx.coupon.updateMany({ where: { id: current.couponId, usageCount: { gt: 0 } }, data: { usageCount: { decrement: 1 } } });
  if (counter.count !== 1) throw new CouponDomainError("COUPON_STALE_STATE");
  const redemption = await tx.couponRedemption.findUniqueOrThrow({ where: { id: current.id } });
  await tx.couponRedemptionAudit.create({ data: { redemptionId: redemption.id, couponId: redemption.couponId, campaignId: redemption.campaignId, userId: redemption.userId, orderId: redemption.orderId, idempotencyKey: redemption.idempotencyKey, previousState: "RESERVED", nextState: "RELEASED", couponVersion: redemption.couponVersion, reason: input.reason?.trim() || "RESERVATION_RELEASED" } });
  return { redemption, replay: false };
}

export async function createCampaignAccessCoupon(actorUserId: string, payload: unknown, client?: Client) {
  client ??= (await import("./prisma")).prisma;
  try {
    return await client.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
      if (actor?.role !== "ADMIN") throw new CouponDomainError("COUPON_FORBIDDEN");
      const campaignId = typeof payload === "object" && payload !== null && "campaignId" in payload && typeof payload.campaignId === "string" ? payload.campaignId : null;
      const campaign = campaignId ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { id: true, status: true, effectiveFrom: true, effectiveUntil: true } }) : null;
      const now = new Date();
      if (!campaign || campaign.status === "CANCELLED" || campaign.effectiveUntil <= now) throw new CouponDomainError("COUPON_CAMPAIGN_INVALID");
      const parsed = createCampaignAccessCouponSchema.safeParse(payload);
      if (!parsed.success) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
      const code = normalizeCampaignAccessCode(parsed.data.code);
      const validFrom = parsed.data.validFrom ? new Date(parsed.data.validFrom) : campaign.effectiveFrom;
      const validUntil = parsed.data.validUntil ? new Date(parsed.data.validUntil) : campaign.effectiveUntil;
      if (validFrom < campaign.effectiveFrom || validUntil > campaign.effectiveUntil || validFrom >= validUntil || validUntil <= now) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
      const coupon = await tx.coupon.create({ data: {
        code, name: parsed.data.name, accessMode: "CAMPAIGN_ACCESS", lifecycleStatus: "ACTIVE", campaignId: campaign.id,
        discountType: null, discountValue: null, maxDiscount: null, minimumAmount: null,
        active: true, validFrom, validUntil, usageLimit: parsed.data.globalRedemptionLimit ?? null,
        perUserLimit: parsed.data.perUserRedemptionLimit, version: 1,
      } });
      await tx.adminAuditLog.create({ data: { actorUserId, action: "CAMPAIGN_ACCESS_COUPON_CREATED", entityType: "COUPON", entityId: coupon.id, toStatus: "ACTIVE", note: parsed.data.reason } });
      return coupon;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new CouponDomainError("COUPON_CODE_CONFLICT");
    throw error;
  }
}

export async function setCampaignAccessCouponLifecycle(actorUserId: string, couponId: string, payload: unknown, client?: Client) {
  client ??= (await import("./prisma")).prisma;
  const parsed = couponLifecycleMutationSchema.safeParse(payload);
  if (!parsed.success) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
  try {
    return await client.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
      if (actor?.role !== "ADMIN") throw new CouponDomainError("COUPON_FORBIDDEN");
      const before = await tx.coupon.findUnique({ where: { id: couponId }, include: { campaign: { select: { status: true, effectiveUntil: true } } } });
      if (!before || before.accessMode !== "CAMPAIGN_ACCESS") throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
      if (before.version !== parsed.data.expectedVersion) throw new CouponDomainError("COUPON_STALE_STATE");
      if (parsed.data.lifecycleStatus === "ACTIVE" && (!before.campaign || before.campaign.status === "CANCELLED" || before.campaign.effectiveUntil <= new Date())) throw new CouponDomainError("COUPON_CAMPAIGN_INVALID");
      if (before.lifecycleStatus === parsed.data.lifecycleStatus) return before;
      const changed = await tx.coupon.updateMany({ where: { id: couponId, version: parsed.data.expectedVersion, lifecycleStatus: before.lifecycleStatus }, data: { lifecycleStatus: parsed.data.lifecycleStatus, active: parsed.data.lifecycleStatus === "ACTIVE", version: { increment: 1 } } });
      if (changed.count !== 1) throw new CouponDomainError("COUPON_STALE_STATE");
      const after = await tx.coupon.findUniqueOrThrow({ where: { id: couponId } });
      await tx.adminAuditLog.create({ data: { actorUserId, action: parsed.data.lifecycleStatus === "REVOKED" ? "CAMPAIGN_ACCESS_COUPON_REVOKED" : "CAMPAIGN_ACCESS_COUPON_ACTIVATED", entityType: "COUPON", entityId: couponId, fromStatus: before.lifecycleStatus, toStatus: after.lifecycleStatus, note: parsed.data.reason } });
      return after;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if ((error as { code?: string }).code === "P2034") throw new CouponDomainError("COUPON_STALE_STATE");
    throw error;
  }
}
