import "server-only";

import { Prisma, type PrismaClient, type SellerInstallmentAuthorizationMode, type UserRole } from "@prisma/client";
import { CANONICAL_INSTALLMENT_COUNTS, parseInstallmentCount, type InstallmentCount } from "./installment-policy";
import { prisma } from "./prisma";

export type SellerInstallmentControlErrorCode =
  | "FORBIDDEN"
  | "SELLER_NOT_FOUND"
  | "CONTROL_NOT_FOUND"
  | "INVALID_AUTHORIZATION_MODE"
  | "INVALID_ALLOWED_INSTALLMENTS"
  | "PREFERENCE_OUTSIDE_DELEGATION"
  | "INVALID_REASON"
  | "STALE_VERSION"
  | "CONCURRENT_CHANGE";

export class SellerInstallmentControlError extends Error {
  constructor(readonly code: SellerInstallmentControlErrorCode) { super(code); }
}

type TransactionHost = Pick<PrismaClient, "$transaction">;
type ReadClient = Pick<PrismaClient, "sellerInstallmentControl">;
const MODES = Object.freeze(["DISABLED", "REQUEST_ONLY", "DELEGATED"] as const);

function parseMode(raw: unknown): SellerInstallmentAuthorizationMode {
  if (typeof raw !== "string" || !MODES.includes(raw as SellerInstallmentAuthorizationMode)) {
    throw new SellerInstallmentControlError("INVALID_AUTHORIZATION_MODE");
  }
  return raw as SellerInstallmentAuthorizationMode;
}

export function parseInstallmentSet(raw: unknown): readonly InstallmentCount[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new SellerInstallmentControlError("INVALID_ALLOWED_INSTALLMENTS");
  let parsed: InstallmentCount[];
  try { parsed = raw.map(parseInstallmentCount); }
  catch { throw new SellerInstallmentControlError("INVALID_ALLOWED_INSTALLMENTS"); }
  if (new Set(parsed).size !== parsed.length || !parsed.includes(1)) {
    throw new SellerInstallmentControlError("INVALID_ALLOWED_INSTALLMENTS");
  }
  return Object.freeze(CANONICAL_INSTALLMENT_COUNTS.filter((count) => parsed.includes(count)));
}

function parseReason(raw: unknown) {
  if (typeof raw !== "string") throw new SellerInstallmentControlError("INVALID_REASON");
  const reason = raw.trim();
  if (reason.length < 3 || reason.length > 500) throw new SellerInstallmentControlError("INVALID_REASON");
  return reason;
}

function parseExpectedVersion(raw: unknown, allowZero = false) {
  if (!Number.isInteger(raw) || (raw as number) < (allowZero ? 0 : 1)) throw new SellerInstallmentControlError("STALE_VERSION");
  return raw as number;
}

function jsonSet(value: Prisma.JsonValue): readonly InstallmentCount[] {
  return parseInstallmentSet(value);
}

function state(control: Readonly<{
  authorizationMode: SellerInstallmentAuthorizationMode;
  delegatedAllowedInstallments: Prisma.JsonValue;
  participationEnabled: boolean;
  sellerPreferenceAllowedInstallments: Prisma.JsonValue;
  version: number;
}>) {
  return Object.freeze({
    authorizationMode: control.authorizationMode,
    delegatedAllowedInstallments: [...jsonSet(control.delegatedAllowedInstallments)],
    participationEnabled: control.participationEnabled,
    sellerPreferenceAllowedInstallments: [...jsonSet(control.sellerPreferenceAllowedInstallments)],
    version: control.version,
  });
}

function auditState(value: ReturnType<typeof state>): Prisma.InputJsonObject {
  return {
    authorizationMode: value.authorizationMode,
    delegatedAllowedInstallments: [...value.delegatedAllowedInstallments],
    participationEnabled: value.participationEnabled,
    sellerPreferenceAllowedInstallments: [...value.sellerPreferenceAllowedInstallments],
    version: value.version,
  };
}

function isSerializationFailure(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2034" || (error.code === "P2010" && JSON.stringify(error.meta ?? {}).includes("40001")));
}

async function assertAdmin(tx: Prisma.TransactionClient, actorUserId: string): Promise<UserRole> {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
  if (actor?.role !== "ADMIN") throw new SellerInstallmentControlError("FORBIDDEN");
  return actor.role;
}

export function evaluateSellerInstallmentControl(control: Readonly<{
  authorizationMode: SellerInstallmentAuthorizationMode;
  delegatedAllowedInstallments: Prisma.JsonValue;
  participationEnabled: boolean;
  sellerPreferenceAllowedInstallments: Prisma.JsonValue;
  version: number;
}> | null) {
  if (!control) return Object.freeze({ authorizationMode: "DISABLED" as const, effectiveAllowedInstallments: Object.freeze([1] as const), conflictReason: "CONTROL_MISSING" as const, version: null });
  const delegated = jsonSet(control.delegatedAllowedInstallments);
  const preference = jsonSet(control.sellerPreferenceAllowedInstallments);
  const outside = preference.some((count) => !delegated.includes(count));
  const conflictReason = outside ? "PREFERENCE_OUTSIDE_DELEGATION" as const : null;
  const effectiveAllowedInstallments = control.authorizationMode === "DELEGATED" && control.participationEnabled && !outside
    ? preference
    : Object.freeze([1] as const);
  return Object.freeze({ authorizationMode: control.authorizationMode, effectiveAllowedInstallments, conflictReason, version: control.version });
}

export async function getSellerInstallmentControl(sellerId: string, client: ReadClient = prisma) {
  return evaluateSellerInstallmentControl(await client.sellerInstallmentControl.findUnique({ where: { sellerId } }));
}

export async function setSellerInstallmentAuthorization(input: Readonly<{
  actorUserId: string;
  sellerId: string;
  authorizationMode: unknown;
  delegatedAllowedInstallments: unknown;
  expectedVersion: unknown;
  reason: unknown;
}>, client: TransactionHost = prisma) {
  const authorizationMode = parseMode(input.authorizationMode);
  const delegated = parseInstallmentSet(input.delegatedAllowedInstallments);
  const expectedVersion = parseExpectedVersion(input.expectedVersion, true);
  const reason = parseReason(input.reason);
  try {
    return await client.$transaction(async (tx) => {
      const actorRole = await assertAdmin(tx, input.actorUserId);
      await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${input.sellerId} FOR UPDATE`;
      if (!await tx.sellerProfile.findUnique({ where: { id: input.sellerId }, select: { id: true } })) throw new SellerInstallmentControlError("SELLER_NOT_FOUND");
      const current = await tx.sellerInstallmentControl.findUnique({ where: { sellerId: input.sellerId } });
      if (!current) {
        if (expectedVersion !== 0) throw new SellerInstallmentControlError("STALE_VERSION");
        const created = await tx.sellerInstallmentControl.create({ data: { sellerId: input.sellerId, authorizationMode, delegatedAllowedInstallments: [...delegated], sellerPreferenceAllowedInstallments: [1] } });
        const next = state(created);
        await tx.sellerInstallmentControlAudit.create({ data: { controlId: created.id, sellerId: input.sellerId, actorUserId: input.actorUserId, actorRole, action: "AUTHORIZATION_CREATED", newState: auditState(next), newVersion: 1, reason } });
        return Object.freeze({ id: created.id, ...next, conflictReason: null });
      }
      if (current.version !== expectedVersion) throw new SellerInstallmentControlError("STALE_VERSION");
      await tx.$queryRaw`SELECT "id" FROM "SellerInstallmentControl" WHERE "id" = ${current.id} FOR UPDATE`;
      const previous = state(current);
      const changed = await tx.sellerInstallmentControl.updateMany({ where: { id: current.id, sellerId: input.sellerId, version: expectedVersion }, data: { authorizationMode, delegatedAllowedInstallments: [...delegated], version: { increment: 1 } } });
      if (changed.count !== 1) throw new SellerInstallmentControlError("STALE_VERSION");
      const updated = await tx.sellerInstallmentControl.findUniqueOrThrow({ where: { id: current.id } });
      const next = state(updated);
      await tx.sellerInstallmentControlAudit.create({ data: { controlId: current.id, sellerId: input.sellerId, actorUserId: input.actorUserId, actorRole, action: "AUTHORIZATION_UPDATED", previousState: auditState(previous), newState: auditState(next), expectedVersion, previousVersion: previous.version, newVersion: next.version, reason } });
      return Object.freeze({ id: updated.id, ...next, conflictReason: evaluateSellerInstallmentControl(updated).conflictReason });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializationFailure(error)) throw new SellerInstallmentControlError("CONCURRENT_CHANGE");
    throw error;
  }
}

export async function setOwnSellerInstallmentPreference(input: Readonly<{
  actorUserId: string;
  controlId: string;
  participationEnabled: unknown;
  sellerPreferenceAllowedInstallments: unknown;
  expectedVersion: unknown;
  reason: unknown;
}>, client: TransactionHost = prisma) {
  if (typeof input.participationEnabled !== "boolean") throw new SellerInstallmentControlError("FORBIDDEN");
  const participationEnabled = input.participationEnabled;
  const preference = parseInstallmentSet(input.sellerPreferenceAllowedInstallments);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const reason = parseReason(input.reason);
  try {
    return await client.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { role: true, sellerProfile: { select: { id: true } } } });
      if (actor?.role !== "SELLER" || !actor.sellerProfile) throw new SellerInstallmentControlError("FORBIDDEN");
      await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${actor.sellerProfile.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "SellerInstallmentControl" WHERE "id" = ${input.controlId} FOR UPDATE`;
      const current = await tx.sellerInstallmentControl.findFirst({ where: { id: input.controlId, sellerId: actor.sellerProfile.id } });
      if (!current) throw new SellerInstallmentControlError("CONTROL_NOT_FOUND");
      if (current.version !== expectedVersion) throw new SellerInstallmentControlError("STALE_VERSION");
      const delegated = jsonSet(current.delegatedAllowedInstallments);
      if (preference.some((count) => !delegated.includes(count))) throw new SellerInstallmentControlError("PREFERENCE_OUTSIDE_DELEGATION");
      const previous = state(current);
      const changed = await tx.sellerInstallmentControl.updateMany({ where: { id: current.id, sellerId: actor.sellerProfile.id, version: expectedVersion }, data: { participationEnabled, sellerPreferenceAllowedInstallments: [...preference], version: { increment: 1 } } });
      if (changed.count !== 1) throw new SellerInstallmentControlError("STALE_VERSION");
      const updated = await tx.sellerInstallmentControl.findUniqueOrThrow({ where: { id: current.id } });
      const next = state(updated);
      await tx.sellerInstallmentControlAudit.create({ data: { controlId: current.id, sellerId: actor.sellerProfile.id, actorUserId: input.actorUserId, actorRole: actor.role, action: "SELLER_PREFERENCE_UPDATED", previousState: auditState(previous), newState: auditState(next), expectedVersion, previousVersion: previous.version, newVersion: next.version, reason } });
      return Object.freeze({ id: updated.id, ...next, conflictReason: null });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializationFailure(error)) throw new SellerInstallmentControlError("CONCURRENT_CHANGE");
    throw error;
  }
}
