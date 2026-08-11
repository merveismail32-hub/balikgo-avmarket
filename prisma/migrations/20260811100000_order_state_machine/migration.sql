ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'READY_TO_SHIP';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURN_REQUESTED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURNED';
CREATE TABLE "OrderStatusHistory" ("id" TEXT NOT NULL, "orderItemId" TEXT NOT NULL, "fromStatus" "OrderStatus", "toStatus" "OrderStatus" NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id"));
CREATE INDEX "OrderStatusHistory_orderItemId_createdAt_idx" ON "OrderStatusHistory"("orderItemId", "createdAt");
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
