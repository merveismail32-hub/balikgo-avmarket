-- Existing order items remain valid; historical rows keep a NULL SKU snapshot.
ALTER TABLE "OrderItem" ADD COLUMN "productSku" VARCHAR(80);

-- Existing status history remains valid; actor is recorded for future changes.
ALTER TABLE "OrderStatusHistory" ADD COLUMN "changedByUserId" TEXT;

CREATE INDEX "OrderStatusHistory_changedByUserId_idx" ON "OrderStatusHistory"("changedByUserId");

ALTER TABLE "OrderStatusHistory"
ADD CONSTRAINT "OrderStatusHistory_changedByUserId_fkey"
FOREIGN KEY ("changedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
