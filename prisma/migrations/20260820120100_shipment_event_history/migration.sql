CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "externalEventId" VARCHAR(191) NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" VARCHAR(160),
    "description" VARCHAR(500),
    "payloadHash" VARCHAR(64),
    "applied" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShipmentEvent_shipmentId_source_externalEventId_key" ON "ShipmentEvent"("shipmentId", "source", "externalEventId");
CREATE INDEX "ShipmentEvent_shipmentId_eventTime_receivedAt_idx" ON "ShipmentEvent"("shipmentId", "eventTime", "receivedAt");
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
