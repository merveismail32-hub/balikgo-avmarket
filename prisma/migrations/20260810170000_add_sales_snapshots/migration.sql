ALTER TABLE "OrderItem" ADD COLUMN "commissionRate" DECIMAL(5,4);
ALTER TABLE "OrderItem" ADD COLUMN "commissionAmount" DECIMAL(12,2);
ALTER TABLE "OrderItem" ADD COLUMN "sellerNetAmount" DECIMAL(12,2);
