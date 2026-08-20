import "server-only";

import { Prisma, type ShipmentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { carrierAdapterFor, carrierEventDecision } from "./shipping";
import { transitionShipmentInTransaction } from "./shipment-orchestrator";

export type CarrierShipmentEventInput = {
  shipmentId: string;
  carrierCode: string;
  trackingNumber: string;
  externalEventId: string;
  status: string;
  eventTime: Date;
  location?: string;
  description?: string;
  payloadHash?: string;
};

const cleanOptional = (value: string | undefined, max: number) => value?.trim().slice(0, max) || undefined;

export async function ingestCarrierShipmentEvent(input: CarrierShipmentEventInput) {
  const adapter = carrierAdapterFor(input.carrierCode);
  const normalized = adapter?.normalizeEvent({ status: input.status, trackingNumber: input.trackingNumber });
  if (!adapter || !normalized || !input.externalEventId.trim() || input.externalEventId.trim().length > 191 || Number.isNaN(input.eventTime.getTime())) throw new Error("INVALID_CARRIER_EVENT");
  if (input.payloadHash && !/^[a-f0-9]{64}$/i.test(input.payloadHash)) throw new Error("INVALID_PAYLOAD_HASH");
  const source = input.carrierCode.trim().toUpperCase().replaceAll("-", "_");
  const externalEventId = input.externalEventId.trim();

  try {
    return await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id: input.shipmentId, carrierCode: source, trackingNumber: normalized.trackingNumber },
        select: { id: true, sellerId: true, status: true, seller: { select: { userId: true } }, events: { where: { applied: true }, orderBy: [{ eventTime: "desc" }, { receivedAt: "desc" }], take: 1, select: { eventTime: true } } },
      });
      if (!shipment) return null;
      const duplicate = await tx.shipmentEvent.findUnique({ where: { shipmentId_source_externalEventId: { shipmentId: shipment.id, source, externalEventId } }, select: { id: true, applied: true, status: true } });
      if (duplicate) return { status: duplicate.status, idempotent: true, applied: duplicate.applied, stale: !duplicate.applied };

      const target = normalized.status as ShipmentStatus;
      const decision = carrierEventDecision(shipment.status, target, input.eventTime, shipment.events[0]?.eventTime);
      const event = await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, source, externalEventId, status: target, eventTime: input.eventTime, location: cleanOptional(input.location, 160), description: cleanOptional(input.description, 500), payloadHash: input.payloadHash?.toLowerCase(), applied: decision.apply || decision.equivalent } });
      if (!decision.apply) return { status: shipment.status, eventId: event.id, idempotent: decision.equivalent, applied: decision.equivalent, stale: decision.stale };
      const transitioned = await transitionShipmentInTransaction(tx, { shipmentId: shipment.id, sellerId: shipment.sellerId, sellerUserId: shipment.seller.userId, status: target, source: input.carrierCode, externalEventId: input.externalEventId, eventTime: input.eventTime, createEvent: false });
      return { ...transitioned!, eventId: event.id, applied: true, stale: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.shipmentEvent.findUnique({ where: { shipmentId_source_externalEventId: { shipmentId: input.shipmentId, source, externalEventId } }, select: { status: true, applied: true } });
      if (duplicate) return { status: duplicate.status, idempotent: true, applied: duplicate.applied, stale: !duplicate.applied };
    }
    throw error;
  }
}
