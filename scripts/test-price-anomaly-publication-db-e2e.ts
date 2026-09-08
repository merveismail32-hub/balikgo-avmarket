import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hash } from "bcryptjs";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { createSellerOfferWithPriceEvidence, setSellerOfferPrice } from "../app/lib/seller-offer-price";
import { enforcePriceAnomalyPublication } from "../app/lib/price-anomaly-publication";
import { publicProductPolicy } from "../app/lib/product-visibility";
import { revalidateOffer, resolveBuybox } from "../app/lib/buybox";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const token = crypto.randomUUID(); const prefix = `qa-hold-${token}`;
const ids = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], products: [] as string[], offers: [] as string[] };

async function cleanup() {
  if (ids.offers.length) { const holds = await prisma.sellerOfferPriceAnomalyHold.findMany({ where: { sellerOfferId: { in: ids.offers } }, select: { id: true } }); await prisma.sellerOfferPriceAnomalyRelease.deleteMany({ where: { holdId: { in: holds.map((h) => h.id) } } }); await prisma.sellerOfferPriceAnomalyHold.deleteMany({ where: { id: { in: holds.map((h) => h.id) } } }); await prisma.sellerOfferPriceObservation.deleteMany({ where: { sellerOfferId: { in: ids.offers } } }); await prisma.sellerOffer.deleteMany({ where: { id: { in: ids.offers } } }); }
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.catalogs.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: ids.catalogs } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  if (ids.offers.length) assert.equal(await prisma.sellerOffer.count({ where: { id: { in: ids.offers } } }), 0, "offer cleanup failed");
  if (ids.products.length) assert.equal(await prisma.product.count({ where: { id: { in: ids.products } } }), 0, "product cleanup failed");
  if (ids.users.length) assert.equal(await prisma.user.count({ where: { id: { in: ids.users } } }), 0, "user cleanup failed");
}

async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database, current_user role`;
  assert.deepEqual(identity[0], { database: TEST_DB_IDENTITY.database, role: "postgres" });
  const passwordHash = await hash("qa-only", 4);
  for (let i=0;i<3;i+=1) { const user=await prisma.user.create({data:{name:"QA",surname:String(i),email:`${prefix}-${i}@invalid.local`,phone:"0",passwordHash,role:"SELLER",sellerProfile:{create:{storeName:`${prefix}-${i}`,companyType:"QA",taxNumber:crypto.randomUUID().replaceAll("-","").slice(0,10),taxOffice:"QA",city:"QA",address:"QA",description:"QA",status:"APPROVED"}}},include:{sellerProfile:true}}); ids.users.push(user.id);ids.sellers.push(user.sellerProfile!.id); }
  const catalog=await prisma.catalogProduct.create({data:{slug:`${prefix}-catalog`,identityKey:prefix,name:"QA",category:"QA",brand:"QA",description:"QA",imageUrl:"/qa",active:true,moderationStatus:"APPROVED"}});ids.catalogs.push(catalog.id);
  async function create(i:number,price:string){const product=await prisma.product.create({data:{sellerId:ids.sellers[i],catalogProductId:catalog.id,name:"QA",slug:`${prefix}-p-${i}`,category:"QA",brand:"QA",price,stock:5,description:"QA",imageUrl:"/qa",active:true,moderationStatus:"APPROVED"}});ids.products.push(product.id);const offer=await prisma.$transaction(tx=>createSellerOfferWithPriceEvidence(tx,{data:{sellerId:ids.sellers[i],catalogProductId:catalog.id,legacyProductId:product.id,sellerSku:`${prefix}-${i}`,price,stock:5,active:true},source:"SELLER_PRODUCT_CREATE",actorUserId:ids.users[i]}));ids.offers.push(offer.id);return{product,offer};}
  await create(0,"100"); await create(1,"110"); const target=await create(2,"100");
  const normal=await prisma.sellerOffer.findUniqueOrThrow({where:{id:target.offer.id}});assert.equal(normal.priceAnomalyHeld,false);
  await prisma.$transaction(tx=>setSellerOfferPrice(tx,{sellerOfferId:normal.id,sellerId:ids.sellers[2],productId:target.product.id,expectedPriceVersion:1,price:"10",source:"SELLER_PRODUCT_PATCH",actorUserId:ids.users[2]}));
  let row=await prisma.sellerOffer.findUniqueOrThrow({where:{id:target.offer.id}}); assert.equal(row.price.toString(),"10");assert.equal(row.priceAnomalyHeld,true);assert.equal(row.active,true);
  assert.equal(await prisma.sellerOfferPriceObservation.count({where:{sellerOfferId:row.id}}),2);assert.equal(await prisma.sellerOfferPriceAnomalyHold.count({where:{sellerOfferId:row.id}}),1);
  const hold=await prisma.sellerOfferPriceAnomalyHold.findFirstOrThrow({where:{sellerOfferId:row.id}});assert.equal(hold.triggerPriceVersion,2);assert.equal(hold.anomalyStatus,"CRITICAL");assert.equal(hold.anomalyConfidence,"HIGH");
  assert.equal(await prisma.product.findFirst({where:{id:target.product.id,...publicProductPolicy}}),null);
  const buyboxOffer={id:row.id,catalogProductId:row.catalogProductId,sellerId:row.sellerId,price:Number(row.price),stock:row.stock,active:row.active,priceAnomalyHeld:row.priceAnomalyHeld,handlingTimeDays:row.handlingTimeDays,sellerStatus:"APPROVED"};assert.equal(resolveBuybox({id:catalog.id,active:true,moderationStatus:"APPROVED"},[buyboxOffer]).winner,null);assert.equal(revalidateOffer({id:catalog.id,active:true,moderationStatus:"APPROVED"},buyboxOffer).eligible,false);
  const before={orders:await prisma.order.count({where:{items:{some:{sellerOfferId:row.id}}}}),payments:await prisma.payment.count({where:{order:{items:{some:{sellerOfferId:row.id}}}}}),stock:row.stock};
  const sellerRead=await prisma.sellerOffer.findFirst({where:{id:row.id,sellerId:ids.sellers[2]}});assert(sellerRead);
  const replays = await Promise.all([1, 2].map(() => prisma.$transaction((tx) =>
    enforcePriceAnomalyPublication(tx, { sellerOfferId: row.id, sellerId: row.sellerId, expectedPriceVersion: 2 }),
  )));
  assert(replays.every((replay) => replay.action === "UNCHANGED_HELD"));
  assert.equal(await prisma.sellerOfferPriceAnomalyHold.count({ where: { sellerOfferId: row.id } }), 1);
  const noOp=await prisma.$transaction(tx=>setSellerOfferPrice(tx,{sellerOfferId:row.id,sellerId:ids.sellers[2],productId:target.product.id,expectedPriceVersion:2,price:"10.00",source:"SELLER_PRODUCT_PATCH",actorUserId:ids.users[2]}));assert.equal(noOp.changed,false);assert.equal((await prisma.sellerOffer.findUniqueOrThrow({where:{id:row.id}})).priceAnomalyHeld,true);
  const corrected=await prisma.$transaction(tx=>setSellerOfferPrice(tx,{sellerOfferId:row.id,sellerId:ids.sellers[2],productId:target.product.id,expectedPriceVersion:2,price:"100",source:"SELLER_PRODUCT_PATCH",actorUserId:ids.users[2]}));assert.equal(corrected.priceVersion,3);
  row=await prisma.sellerOffer.findUniqueOrThrow({where:{id:row.id}});assert.equal(row.priceAnomalyHeld,false);assert.equal(await prisma.sellerOfferPriceAnomalyRelease.count({where:{holdId:hold.id}}),1);assert(await prisma.product.findFirst({where:{id:target.product.id,...publicProductPolicy}}));
  const stale=await prisma.$transaction(tx=>enforcePriceAnomalyPublication(tx,{sellerOfferId:row.id,sellerId:row.sellerId,expectedPriceVersion:2}));assert.equal(stale.action,"STALE");assert.equal((await prisma.sellerOffer.findUniqueOrThrow({where:{id:row.id}})).priceAnomalyHeld,false);
  const after={orders:await prisma.order.count({where:{items:{some:{sellerOfferId:row.id}}}}),payments:await prisma.payment.count({where:{order:{items:{some:{sellerOfferId:row.id}}}}}),stock:row.stock};assert.deepEqual(after,before);
  assert.equal(await prisma.sellerOfferPriceObservation.count({where:{sellerOfferId:row.id}}),3);assert.equal(hold.activeKey,`PRICE_ANOMALY:${row.id}`);assert.equal((await prisma.sellerOfferPriceAnomalyHold.findUniqueOrThrow({where:{id:hold.id}})).activeKey,null);
  console.log("PASS: #25 Slice E guarded TEST DB hold, immutable trigger, public/Buybox/checkout exclusion, seller correction, release, no-op, stale binding, economics and cleanup");
}
cleanup().then(main).finally(async()=>{await cleanup();await prisma.$disconnect();});
