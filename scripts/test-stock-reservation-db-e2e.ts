import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { guardedTestConnectionOptions, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { processPaymentCallback, processVerifiedPaymentEvent } from "../app/lib/payment-orchestrator";
import { assertPaymentPaidForFulfillment, cancelOrderItem } from "../app/lib/order-orchestrator";

const prisma = new PrismaClient({ adapter: new PrismaPg(guardedTestConnectionOptions()), transactionOptions: { maxWait: 60_000, timeout: 120_000 } });
const all = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], products: [] as string[], offers: [] as string[], orders: [] as string[], payments: [] as string[], coupons: [] as string[] };
const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function fixture(input: { items?: number; coupon?: boolean } = {}) {
  const key=randomUUID(), itemCount=input.items??1;
  const customer=await prisma.user.create({data:{name:"R",surname:"QA",email:`reservation-c-${key}@invalid.local`,phone:"0",passwordHash:"qa"}});all.users.push(customer.id);
  const sellerUser=await prisma.user.create({data:{name:"R",surname:"S",email:`reservation-s-${key}@invalid.local`,phone:"0",passwordHash:"qa",role:"SELLER",sellerProfile:{create:{storeName:`r-${key}`,storeSlug:`r-${key}`,companyType:"QA",taxNumber:`r-${key}`,taxOffice:"QA",city:"QA",address:"QA",description:"QA",status:"APPROVED"}}},include:{sellerProfile:true}});all.users.push(sellerUser.id);all.sellers.push(sellerUser.sellerProfile!.id);
  const lines: Prisma.OrderItemUncheckedCreateWithoutOrderInput[]=[];
  for(let i=0;i<itemCount;i++){const catalog=await prisma.catalogProduct.create({data:{slug:`r-c-${key}-${i}`,identityKey:`r:${key}:${i}`,name:"R",category:"QA",brand:"QA",description:"QA",imageUrl:"/qa"}});all.catalogs.push(catalog.id);const product=await prisma.product.create({data:{sellerId:sellerUser.sellerProfile!.id,catalogProductId:catalog.id,name:"R",slug:`r-p-${key}-${i}`,category:"QA",brand:"QA",price:100,stock:0,description:"QA",imageUrl:"/qa"}});all.products.push(product.id);const offer=await prisma.sellerOffer.create({data:{sellerId:sellerUser.sellerProfile!.id,catalogProductId:catalog.id,legacyProductId:product.id,sellerSku:`R-${key}-${i}`,price:100,stock:0}});all.offers.push(offer.id);lines.push({productId:product.id,catalogProductId:catalog.id,sellerOfferId:offer.id,sellerId:sellerUser.sellerProfile!.id,productName:"R",productImageUrl:"/qa",unitPrice:100,quantity:1,commissionAmount:10,sellerNetAmount:90,stockReservationState:"RESERVED"});}
  const coupon=input.coupon?await prisma.coupon.create({data:{code:`R${key.replaceAll("-","").slice(0,20)}`,name:"R",discountType:"FIXED",discountValue:10,usageCount:1}}):null;if(coupon)all.coupons.push(coupon.id);
  const order=await prisma.order.create({data:{userId:customer.id,orderNumber:`R-${key}`,clientRequestId:randomUUID(),totalAmount:100*itemCount,recipientName:"QA",phone:"0",city:"QA",district:"QA",address:"QA",couponId:coupon?.id,couponCode:coupon?.code,items:{create:lines}},include:{items:true}});all.orders.push(order.id);
  if(coupon)await prisma.couponRedemption.create({data:{couponId:coupon.id,userId:customer.id,orderId:order.id,discountAmount:10}});
  const payment=await prisma.payment.create({data:{orderId:order.id,amount:100*itemCount,provider:"TEST_PENDING",status:"PENDING",reservationExpiresAt:new Date(Date.now()+15*60_000)}});all.payments.push(payment.id);
  for(const item of order.items){const payout=await prisma.sellerPayout.create({data:{sellerId:sellerUser.sellerProfile!.id,orderId:order.id,orderItemId:item.id,grossAmount:100,commissionAmount:10,netAmount:90}});await prisma.financialLedgerEntry.createMany({data:[{sellerId:sellerUser.sellerProfile!.id,orderItemId:item.id,payoutId:payout.id,type:"SALE",amount:100},{sellerId:sellerUser.sellerProfile!.id,orderItemId:item.id,payoutId:payout.id,type:"COMMISSION",amount:10}]});}
  return {customer,sellerUser,order,payment,coupon};
}
const event=(payment:{id:string;amount:Prisma.Decimal},type:"PAYMENT_PAID"|"PAYMENT_FAILED",id=randomUUID())=>({provider:"TEST",event:{eventId:`reservation-${id}`,paymentId:payment.id,eventType:type,amount:payment.amount.toString(),currency:"TRY" as const},payloadHash:"reservation-e2e"});

async function verifyPaymentCallbacks() {
  const paid = await fixture();
  // An opaque provider verifies that the domain does not depend on the test adapter's name.
  await prisma.payment.update({ where: { id: paid.payment.id }, data: { provider: "QA_GATEWAY" } });
  const success = { ...event(paid.payment, "PAYMENT_PAID"), provider: "QA_GATEWAY" };
  const snapshot = async () => JSON.stringify(await Promise.all([
    prisma.payment.findUniqueOrThrow({ where: { id: paid.payment.id } }),
    prisma.orderItem.findMany({ where: { orderId: paid.order.id }, orderBy: { id: "asc" } }),
    prisma.sellerPayout.findMany({ where: { orderId: paid.order.id }, orderBy: { id: "asc" } }),
    prisma.financialLedgerEntry.count({ where: { orderItem: { orderId: paid.order.id } } }),
    prisma.stockMovement.count({ where: { orderId: paid.order.id } }),
    prisma.notification.count({ where: { orderId: paid.order.id } }),
    prisma.paymentEvent.count({ where: { paymentId: paid.payment.id } }),
    prisma.financialAuditEvent.count({ where: { paymentId: paid.payment.id } }),
  ]));
  const raced = await Promise.all([processPaymentCallback(prisma, success), processPaymentCallback(prisma, success)]);
  assert(raced.filter(result => result.duplicate).length === 1, "CALLBACK_CONCURRENT_DUPLICATE_NOT_IDEMPOTENT");
  const before = await snapshot();
  assert((await processPaymentCallback(prisma, success)).duplicate, "CALLBACK_SEQUENTIAL_REPLAY_FAILED");
  assert(await snapshot() === before, "CALLBACK_REPLAY_CHANGED_BUSINESS_STATE");
  for (const invalid of [
    { ...success, event: { ...success.event, eventType: "PAYMENT_FAILED" as const } },
    { ...success, event: { ...success.event, amount: "1" } },
    { ...success, provider: "OTHER_GATEWAY" },
  ]) {
    await processPaymentCallback(prisma, invalid).then(() => { throw new Error("INVALID_CALLBACK_ACCEPTED"); }, error => {
      assert(error instanceof Error && ["PAYMENT_EVENT_CONFLICT", "AMOUNT_MISMATCH", "PAYMENT_MISMATCH"].includes(error.message), "CALLBACK_WRONG_REJECTION");
    });
  }
  assert(await snapshot() === before, "INVALID_CALLBACK_LEFT_PARTIAL_EFFECTS");
  const conflict = { ...success, event: { ...success.event, eventId: `conflict-${randomUUID()}`, eventType: "PAYMENT_FAILED" as const } };
  const conflicts = await Promise.all([processPaymentCallback(prisma, conflict), processPaymentCallback(prisma, { ...conflict, event: { ...conflict.event, eventId: `conflict-${randomUUID()}` } })]);
  assert(conflicts.every(result => result.reconciliationRequired), "CONFLICTING_CALLBACK_NOT_HANDED_OFF");
  assert(await prisma.paymentReconciliationReview.count({ where: { paymentId: paid.payment.id, reason: "PAYMENT_STOCK_STATE_MISMATCH", status: "PENDING" } }) === 1, "CONFLICTING_CALLBACK_DUPLICATED_REVIEW");
  assert((await prisma.payment.findUniqueOrThrow({ where: { id: paid.payment.id } })).status === "PAID", "CONFLICTING_FAILURE_CHANGED_PAID");
  assert((await prisma.orderItem.findMany({ where: { orderId: paid.order.id } })).every(item => item.stockReservationState === "CONSUMED" && item.stockReservationVersion === 1), "REPLAY_CONSUMED_RESERVATION_TWICE");
  assert(await prisma.stockMovement.count({ where: { orderId: paid.order.id } }) === 0, "CONFLICTING_FAILURE_RELEASED_STOCK");

  const failed = await fixture();
  const failure = event(failed.payment, "PAYMENT_FAILED");
  const failedRace = await Promise.all([processPaymentCallback(prisma, failure), processPaymentCallback(prisma, failure)]);
  assert(failedRace.filter(result => result.duplicate).length === 1, "DUPLICATE_FAILED_CALLBACK_FAILED");
  assert(await prisma.stockMovement.count({ where: { orderId: failed.order.id } }) === 1, "DUPLICATE_FAILED_CALLBACK_RELEASED_TWICE");
  const late = event(failed.payment, "PAYMENT_PAID");
  const lateRace = await Promise.all([processPaymentCallback(prisma, late), processPaymentCallback(prisma, event(failed.payment, "PAYMENT_PAID"))]);
  assert(lateRace.every(result => result.latePaymentReviewRequired), "SUCCESS_AFTER_FAILURE_NOT_QUARANTINED");
  assert(await prisma.paymentReconciliationReview.count({ where: { paymentId: failed.payment.id, reason: "LATE_PAYMENT_SUCCESS", status: "PENDING" } }) === 1, "LATE_SUCCESS_DUPLICATED_REVIEW");
  assert((await prisma.payment.findUniqueOrThrow({ where: { id: failed.payment.id } })).status === "FAILED", "LATE_SUCCESS_REVIVED_FAILED");
  await prisma.payment.update({ where: { id: failed.payment.id }, data: { provider: "QA_GATEWAY" } });
  await processPaymentCallback(prisma, { ...success, event: { ...success.event, paymentId: failed.payment.id } }).then(() => { throw new Error("CROSS_PAYMENT_EVENT_ACCEPTED"); }, error => {
    assert(error instanceof Error && error.message === "PAYMENT_EVENT_CONFLICT", "CROSS_PAYMENT_EVENT_WRONG_REJECTION");
  });
  await prisma.payment.update({ where: { id: failed.payment.id }, data: { status: "CANCELLED" } });
  const cancelled = await processPaymentCallback(prisma, { ...event(failed.payment, "PAYMENT_PAID"), provider: "QA_GATEWAY" });
  assert(cancelled.latePaymentReviewRequired && (await prisma.payment.findUniqueOrThrow({ where: { id: failed.payment.id } })).status === "CANCELLED", "CANCELLED_PAYMENT_REVIVED");
  console.log("PASS: payment callbacks preserve provider isolation, concurrent success/failure replay and reconciliation handoff");
}

async function verifyPaymentRetry() {
  const pending = await fixture({ items: 2 });
  const input = event(pending.payment, "PAYMENT_PAID");
  const failure = new Error("FORCED_CALLBACK_ROLLBACK");
  await prisma.$transaction(async tx => { await processVerifiedPaymentEvent(tx, input); throw failure; }).then(() => { throw new Error("ROLLBACK_NOT_FORCED"); }, error => assert(error === failure, "UNEXPECTED_CALLBACK_ROLLBACK"));
  assert((await prisma.payment.findUniqueOrThrow({ where: { id: pending.payment.id } })).status === "PENDING", "CALLBACK_ROLLBACK_CHANGED_PAYMENT");
  assert(await prisma.paymentEvent.count({ where: { paymentId: pending.payment.id } }) === 0 && await prisma.notification.count({ where: { orderId: pending.order.id } }) === 0, "CALLBACK_ROLLBACK_LEFT_EVENTS");
  assert((await prisma.orderItem.findMany({ where: { orderId: pending.order.id } })).every(item => item.stockReservationState === "RESERVED" && item.stockReservationVersion === 0), "CALLBACK_ROLLBACK_CONSUMED_STOCK");
  await processPaymentCallback(prisma, input);
  assert((await processPaymentCallback(prisma, input)).duplicate, "CALLBACK_RETRY_NOT_IDEMPOTENT");
  assert((await prisma.payment.findUniqueOrThrow({ where: { id: pending.payment.id } })).status === "PAID" && await prisma.paymentEvent.count({ where: { paymentId: pending.payment.id } }) === 1, "CALLBACK_RETRY_DID_NOT_CONVERGE");
  assert((await prisma.orderItem.findMany({ where: { orderId: pending.order.id } })).every(item => item.stockReservationState === "CONSUMED" && item.stockReservationVersion === 1), "CALLBACK_RETRY_CONSUMED_TWICE");
  console.log("PASS: complete callback rollback and same-event retry leave exactly one payment/stock effect");
}
async function cleanup(){
  const [reviews,movements,notifications,audits,ledger,payouts,events,redemptions]=await Promise.all([
    prisma.paymentReconciliationReview.findMany({where:{paymentId:{in:all.payments}},select:{id:true}}),prisma.stockMovement.findMany({where:{sellerOfferId:{in:all.offers}},select:{id:true}}),prisma.notification.findMany({where:{orderId:{in:all.orders}},select:{id:true}}),prisma.financialAuditEvent.findMany({where:{orderId:{in:all.orders}},select:{id:true}}),prisma.financialLedgerEntry.findMany({where:{orderItem:{orderId:{in:all.orders}}},select:{id:true}}),prisma.sellerPayout.findMany({where:{orderId:{in:all.orders}},select:{id:true}}),prisma.paymentEvent.findMany({where:{paymentId:{in:all.payments}},select:{id:true}}),prisma.couponRedemption.findMany({where:{orderId:{in:all.orders}},select:{id:true}}),
  ]);
  const remove=async(rows:{id:string}[],run:(ids:string[])=>Promise<unknown>)=>{if(rows.length)await run(rows.map(row=>row.id));};
  await remove(reviews,ids=>prisma.paymentReconciliationReview.deleteMany({where:{id:{in:ids}}}));await remove(movements,ids=>prisma.stockMovement.deleteMany({where:{id:{in:ids}}}));await remove(notifications,ids=>prisma.notification.deleteMany({where:{id:{in:ids}}}));await remove(audits,ids=>prisma.financialAuditEvent.deleteMany({where:{id:{in:ids}}}));await remove(ledger,ids=>prisma.financialLedgerEntry.deleteMany({where:{id:{in:ids}}}));await remove(payouts,ids=>prisma.sellerPayout.deleteMany({where:{id:{in:ids}}}));await remove(events,ids=>prisma.paymentEvent.deleteMany({where:{id:{in:ids}}}));await remove(redemptions,ids=>prisma.couponRedemption.deleteMany({where:{id:{in:ids}}}));
  if(all.payments.length)await prisma.payment.deleteMany({where:{id:{in:all.payments}}});if(all.orders.length)await prisma.order.deleteMany({where:{id:{in:all.orders}}});if(all.offers.length)await prisma.sellerOffer.deleteMany({where:{id:{in:all.offers}}});if(all.products.length)await prisma.product.deleteMany({where:{id:{in:all.products}}});if(all.catalogs.length)await prisma.catalogProduct.deleteMany({where:{id:{in:all.catalogs}}});if(all.coupons.length)await prisma.coupon.deleteMany({where:{id:{in:all.coupons}}});if(all.sellers.length)await prisma.sellerProfile.deleteMany({where:{id:{in:all.sellers}}});if(all.users.length)await prisma.user.deleteMany({where:{id:{in:all.users}}});
  const remaining=await Promise.all([prisma.order.count({where:{id:{in:all.orders}}}),prisma.stockMovement.count({where:{id:{in:movements.map(x=>x.id)}}}),prisma.user.count({where:{id:{in:all.users}}})]);assert(remaining.every(x=>x===0),"EXACT_ID_CLEANUP_FAILED");
}
async function main(){const identity=await prisma.$queryRaw<Array<{database:string;role:string}>>`select current_database() database,current_user role`;assert(identity[0]?.database===TEST_DB_IDENTITY.database&&identity[0]?.role==="postgres","TEST_IDENTITY_MISMATCH");
  const paid=await fixture();const pendingItems=await prisma.orderItem.findMany({where:{orderId:paid.order.id}});assert(paid.payment.status==="PENDING"&&paid.payment.reservationExpiresAt&&Math.abs(paid.payment.reservationExpiresAt.getTime()-paid.payment.createdAt.getTime()-15*60_000)<5_000&&pendingItems.every(x=>x.stockReservationState==="RESERVED"),"NEW_RESERVATION_WINDOW_FAILED");await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(paid.payment,"PAYMENT_PAID")));const paidItems=await prisma.orderItem.findMany({where:{orderId:paid.order.id}});assert(paidItems.every(x=>x.stockReservationState==="CONSUMED"&&x.stockReservationVersion===1),"PAID_CONSUME_FAILED");await prisma.$transaction(tx=>assertPaymentPaidForFulfillment(tx,paid.order.id));await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(paid.payment,"PAYMENT_FAILED")));assert((await prisma.payment.findUniqueOrThrow({where:{id:paid.payment.id}})).status==="PAID"&&await prisma.stockMovement.count({where:{orderId:paid.order.id}})===0,"PAID_THEN_FAILED_RELEASED");
  const failed=await fixture({items:2,coupon:true});const firstFailed=event(failed.payment,"PAYMENT_FAILED");await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,firstFailed));await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,firstFailed));await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(failed.payment,"PAYMENT_FAILED")));const [failedPayment,failedItems,movements,payouts,reversals,coupon]=await Promise.all([prisma.payment.findUniqueOrThrow({where:{id:failed.payment.id}}),prisma.orderItem.findMany({where:{orderId:failed.order.id}}),prisma.stockMovement.findMany({where:{orderId:failed.order.id}}),prisma.sellerPayout.findMany({where:{orderId:failed.order.id}}),prisma.financialLedgerEntry.count({where:{orderItem:{orderId:failed.order.id},type:{in:["SALE_REVERSAL","COMMISSION_REVERSAL"]}}}),prisma.coupon.findUniqueOrThrow({where:{id:failed.coupon!.id}})]);assert(failedPayment.status==="FAILED"&&failedPayment.stockReleasedAt&&failedPayment.stockReleaseReason==="PAYMENT_FAILED","FAILED_PAYMENT_METADATA");assert(failedItems.every(x=>x.status==="CANCELLED"&&x.stockReservationState==="RELEASED")&&movements.length===2&&payouts.every(x=>x.status==="CANCELLED")&&reversals===4&&coupon.usageCount===0,"FAILED_COMPENSATION_FAILED");await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(failed.payment,"PAYMENT_PAID")));assert((await prisma.payment.findUniqueOrThrow({where:{id:failed.payment.id}})).status==="FAILED"&&await prisma.financialAuditEvent.count({where:{paymentId:failed.payment.id,eventType:"LATE_PAYMENT_REVIEW_REQUIRED"}})===1,"LATE_PAID_REVIVED");
  const raced=await fixture();const failures=await Promise.allSettled(Array.from({length:10},()=>prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(raced.payment,"PAYMENT_FAILED")))));const rejectedCodes=failures.flatMap((result)=>result.status==="rejected"?[String((result.reason as {code?:string;name?:string})?.code??(result.reason as {name?:string})?.name??"UNKNOWN")]:[]);assert(failures.every(x=>x.status==="fulfilled"),`CONCURRENT_FAILED_ERROR:${rejectedCodes.join(",")}`);assert(await prisma.stockMovement.count({where:{orderId:raced.order.id,type:"RESERVATION_RELEASE"}})===1,"CONCURRENT_FAILED_DOUBLE_RELEASE");
  const cancelRace=await fixture();const cr=await Promise.allSettled([prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(cancelRace.payment,"PAYMENT_FAILED"))),prisma.$transaction(tx=>cancelOrderItem(tx,{orderItemId:cancelRace.order.items[0].id,actor:{kind:"CUSTOMER",userId:cancelRace.customer.id}}))]);assert(cr.some(x=>x.status==="fulfilled")&&await prisma.stockMovement.count({where:{orderItemId:cancelRace.order.items[0].id,type:"RESERVATION_RELEASE"}})===1,"FAILED_CANCELLATION_RACE");
  const cancelledLate=await fixture();await prisma.$transaction(tx=>cancelOrderItem(tx,{orderItemId:cancelledLate.order.items[0].id,actor:{kind:"CUSTOMER",userId:cancelledLate.customer.id}}));const lateResult=await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(cancelledLate.payment,"PAYMENT_PAID")));assert(lateResult.latePaymentReviewRequired&&(await prisma.payment.findUniqueOrThrow({where:{id:cancelledLate.payment.id}})).status==="PENDING"&&await prisma.financialAuditEvent.count({where:{paymentId:cancelledLate.payment.id,eventType:"LATE_PAYMENT_REVIEW_REQUIRED"}})===1,"CANCELLED_LATE_PAID_NOT_QUARANTINED");
  const pending=await fixture();await prisma.$transaction(tx=>assertPaymentPaidForFulfillment(tx,pending.order.id)).then(()=>{throw new Error("PENDING_FULFILLMENT_ACCEPTED")},e=>assert(e instanceof Error&&e.message==="PAYMENT_NOT_PAID","PENDING_GATE_WRONG"));
  const terminalRace=await fixture();await Promise.allSettled([prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(terminalRace.payment,"PAYMENT_PAID"))),prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(terminalRace.payment,"PAYMENT_FAILED")))]);const terminal=await prisma.payment.findUniqueOrThrow({where:{id:terminalRace.payment.id}});const terminalItems=await prisma.orderItem.findMany({where:{orderId:terminalRace.order.id}});const terminalMovements=await prisma.stockMovement.count({where:{orderId:terminalRace.order.id}});assert((terminal.status==="PAID"&&terminalItems.every(x=>x.stockReservationState==="CONSUMED")&&terminalMovements===0)||(terminal.status==="FAILED"&&terminalItems.every(x=>x.stockReservationState==="RELEASED")&&terminalMovements===1),"PAID_FAILED_RACE_INCONSISTENT");
  const rollback=await fixture({items:2});await prisma.orderItem.update({where:{id:rollback.order.items[1].id},data:{quantity:0}});await prisma.$transaction(tx=>processVerifiedPaymentEvent(tx,event(rollback.payment,"PAYMENT_FAILED"))).then(()=>{throw new Error("MULTI_ITEM_FAILURE_ACCEPTED")},()=>undefined);const rollbackPayment=await prisma.payment.findUniqueOrThrow({where:{id:rollback.payment.id}});const rollbackItems=await prisma.orderItem.findMany({where:{orderId:rollback.order.id}});assert(rollbackPayment.status==="PENDING"&&rollbackItems.every(x=>x.stockReservationState==="RESERVED")&&await prisma.stockMovement.count({where:{orderId:rollback.order.id}})===0,"MULTI_ITEM_ROLLBACK_FAILED");
  const missing=await fixture();await prisma.payment.delete({where:{id:missing.payment.id}});await prisma.$transaction(tx=>assertPaymentPaidForFulfillment(tx,missing.order.id)).then(()=>{throw new Error("MISSING_PAYMENT_FULFILLMENT_ACCEPTED")},e=>assert(e instanceof Error&&e.message==="PAYMENT_NOT_PAID","MISSING_PAYMENT_GATE_WRONG"));
  await verifyPaymentCallbacks();
  await verifyPaymentRetry();
  console.log("PASS: Phase 2 guarded DB reservation consume/release, races, compensation, late payment and fulfillment gate verified.");}
main().finally(async()=>{await cleanup();await prisma.$disconnect()});
