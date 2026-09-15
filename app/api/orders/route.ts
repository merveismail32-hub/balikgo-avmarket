import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { commissionForCheckoutLine } from "@/app/lib/checkout-commission-policy";
import { enqueueNotifications } from "@/app/lib/notifications";
import { publicProductPolicy } from "@/app/lib/product-visibility";
import { normalizeCouponCode } from "@/app/lib/coupon";
import { evaluateCoupon } from "@/app/lib/coupon-evaluation";
import { customerOrderSelect } from "@/app/lib/customer-order-select";
import { toCustomerOrderDto } from "@/app/lib/customer-shipment-dto";
import { ensureCatalogForProduct } from "@/app/lib/catalog-sync";
import { revalidateOffer } from "@/app/lib/buybox";
import { decrementForCheckout, StockTruthError } from "@/app/lib/stock-truth";
import { InstallmentPolicyConfigError } from "@/app/lib/installment-policy";
import { ProviderInstallmentCapabilityError } from "@/app/lib/payments/installment-capability";
import { EffectiveInstallmentResolutionError } from "@/app/lib/payments/installment-resolution";
import { resolveCheckoutCommercialInstallments } from "@/app/lib/payments/commercial-installment-resolution";
import { CommercialPolicyError } from "@/app/lib/installment-commercial-policy";
import { resolveSellerOfferCampaigns } from "@/app/lib/campaign-resolution";
import { CheckoutCompositionError, composeCheckoutDiscount } from "@/app/lib/checkout-discount-composition";
import { CouponDomainError } from "@/app/lib/coupon-domain";
import { reserveCoupon, resolveCampaignAccessCoupon } from "@/app/lib/coupon-access";
import { reserveRewardForCheckout } from "@/app/lib/reward-checkout";
import { RewardDomainError } from "@/app/lib/reward-domain";
import { reserveWalletForCheckout } from "@/app/lib/stored-value";
import { StoredValueDomainError, semanticHash } from "@/app/lib/stored-value-domain";

const checkoutSchema = z.object({
  clientRequestId: z.string().uuid(),
  address: z.object({ recipientName: z.string().trim().min(3).max(120), phone: z.string().trim().min(8).max(30), city: z.string().trim().min(2).max(80), district: z.string().trim().min(2).max(80), address: z.string().trim().min(10).max(600), postalCode: z.string().trim().max(20).optional() }),
  items: z.array(z.object({ productId: z.string().min(1), catalogProductId: z.string().min(1).optional(), sellerOfferId: z.string().min(1).optional(), quantity: z.number().int().min(1).max(99) }).strict()).min(1).max(50),
  couponCode: z.string().max(50).optional(),
  requestedInstallmentCount: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(9)]).optional(),
  requestedRewardPoints: z.number().int().positive().optional(),
  useMaximumRewardPoints: z.literal(true).optional(),
  useWallet: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  const productIds = value.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) context.addIssue({ code: "custom", path: ["items"], message: "Aynı ürün sepette birden fazla satırda gönderilemez." });
  if (value.requestedRewardPoints !== undefined && value.useMaximumRewardPoints) context.addIssue({ code: "custom", path: ["requestedRewardPoints"], message: "Ödül puanı tercihlerinden yalnız biri seçilebilir." });
});
const internalIncludes = { items: { include: { seller: { select: { id: true, storeName: true, storeSlug: true } } } } } as const;
export async function GET() {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const orders = await prisma.order.findMany({ where: { userId: session.user.id }, select: customerOrderSelect, orderBy: { createdAt: "desc" } });
  return NextResponse.json(orders.map(toCustomerOrderDto));
}
export async function POST(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Sipariş için giriş yapmalısınız." }, { status: 401 });
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Teslimat bilgilerini ve sepeti kontrol edin." }, { status: 400 });
  const { clientRequestId, address, items, requestedInstallmentCount, requestedRewardPoints, useMaximumRewardPoints, useWallet } = parsed.data; const requestedCouponCode=normalizeCouponCode(parsed.data.couponCode);
  const rewardRequested = requestedRewardPoints !== undefined || useMaximumRewardPoints === true;
  try {
    const duplicate = await prisma.order.findUnique({ where: { clientRequestId }, select: { id: true, userId: true, orderNumber: true, couponCode: true, walletUse: true, rewardUseMaximum: true, rewardRequestedPoints: true, payment: { select: { selectedInstallmentCount: true } } } });
    if (duplicate) {
      if (duplicate.userId !== session.user.id || normalizeCouponCode(duplicate.couponCode) !== requestedCouponCode) throw new CouponDomainError("COUPON_IDEMPOTENCY_CONFLICT");
      if (Boolean(duplicate.rewardUseMaximum) !== Boolean(useMaximumRewardPoints) || duplicate.rewardRequestedPoints !== (requestedRewardPoints ?? null)) throw new RewardDomainError("REWARD_IDEMPOTENCY_CONFLICT");
      if (Boolean(duplicate.walletUse) !== (useWallet === true)) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT");
      const retryCount = requestedInstallmentCount ?? 1;
      if ((duplicate.payment?.selectedInstallmentCount === null && requestedInstallmentCount !== undefined)
        || (duplicate.payment?.selectedInstallmentCount !== null && duplicate.payment?.selectedInstallmentCount !== retryCount)) {
        throw new EffectiveInstallmentResolutionError("INSTALLMENT_NOT_AVAILABLE");
      }
      return NextResponse.json({ id: duplicate.id, orderNumber: duplicate.orderNumber });
    }
    const order = await prisma.$transaction(async (tx) => {
      const orderEffectiveAt = new Date();
      const reservationExpiresAt = new Date(Date.now() + 15 * 60_000);
      for (const item of items) await ensureCatalogForProduct(tx, item.productId);
      const products = await tx.product.findMany({ where: { id: { in: items.map((item) => item.productId) }, ...publicProductPolicy }, include: { seller: true, sellerOffer: { include: { seller: true, catalogProduct: true } } } });
      if (products.length !== items.length) throw new Error("Sepetteki ürünlerden biri artık satışta değil.");
      if (products.some((product) => !product.sellerOffer || !product.catalogProductId || !product.sellerOffer.active)) throw new Error("Sepetteki satıcı teklifi artık satışta değil.");
      const productById = new Map(products.map((product) => [product.id, product]));
      const sellerOfferIds = [...new Set(products.map((product) => product.sellerOffer!.id))];
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "SellerOffer" WHERE id IN (${Prisma.join(sellerOfferIds)}) ORDER BY id FOR UPDATE`);
      let campaignAccessCoupon: Awaited<ReturnType<typeof resolveCampaignAccessCoupon>> | null = null;
      if (requestedCouponCode) {
        const candidate = await tx.coupon.findUnique({ where: { code: requestedCouponCode }, select: { accessMode: true } });
        if (candidate?.accessMode === "CAMPAIGN_ACCESS") campaignAccessCoupon = await resolveCampaignAccessCoupon(tx, { couponCode: requestedCouponCode, userId: session.user.id, effectiveAt: orderEffectiveAt });
      }
      const campaignResults = await resolveSellerOfferCampaigns(sellerOfferIds, orderEffectiveAt, tx, campaignAccessCoupon?.campaignId);
      if (campaignAccessCoupon && ![...campaignResults.values()].some(Boolean)) throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
      let total = new Prisma.Decimal(0);
      for (const item of items) {
        const product = productById.get(item.productId);
        if (!product?.sellerOffer || !product.catalogProductId) throw new Error("Sepetteki satıcı teklifi artık satışta değil.");
        if ((item.sellerOfferId && item.sellerOfferId !== product.sellerOffer.id) || (item.catalogProductId && item.catalogProductId !== product.catalogProductId) || product.sellerOffer.catalogProductId !== product.catalogProductId || product.sellerOffer.sellerId !== product.sellerId) throw new Error("Sepetteki ürün ile satıcı teklifi eşleşmiyor.");
        const validation = revalidateOffer(product.sellerOffer.catalogProduct, { ...product.sellerOffer, price: Number(product.sellerOffer.price), sellerStatus: product.sellerOffer.seller.status }, item.quantity);
        if (!validation.eligible) throw new Error(`${product.name} için seçili satıcı teklifi artık uygun değil.`);
        try { await decrementForCheckout(tx, { sellerOfferId: product.sellerOffer.id, productId: product.id, sellerId: product.sellerId, quantity: item.quantity, idempotencyKey: `stock:v1:checkout:${clientRequestId}:${product.sellerOffer.id}`, source: "CHECKOUT", actorSellerId: product.sellerId }); }
        catch (error) { if (error instanceof StockTruthError && error.code === "INSUFFICIENT_STOCK") throw new Error(`${product.name} için stok güncellendi; sepetinizi yeniden kontrol edin.`); throw error; }
        total = total.add(product.sellerOffer.price.mul(item.quantity)).toDecimalPlaces(2);
      }
      const subtotal=total;let coupon=null;let couponCandidates=new Map<string,Prisma.Decimal>();
      if(requestedCouponCode && !campaignAccessCoupon){try{const evaluated=await evaluateCoupon(tx,{code:requestedCouponCode,userId:session.user.id,effectiveAt:orderEffectiveAt,lines:items.map((item)=>{const product=productById.get(item.productId)!;return{productId:item.productId,quantity:item.quantity,product:{sellerId:product.sellerOffer!.sellerId,price:product.sellerOffer!.price}}})});coupon=evaluated.coupon;couponCandidates=evaluated.discounts;}catch(error){if(![...campaignResults.values()].some(Boolean))throw error;}}
      const compositions = new Map(items.map((item) => { const product=productById.get(item.productId)!;const offer=product.sellerOffer!;const couponAmount=couponCandidates.get(product.id);return [product.id,composeCheckoutDiscount({sellerOfferId:offer.id,baseUnitPrice:offer.price,quantity:item.quantity,effectiveAt:orderEffectiveAt,campaign:campaignResults.get(offer.id)??null,coupon:coupon&&couponAmount?{couponId:coupon.id,couponReference:coupon.code,discountAmount:couponAmount}:null})] as const; }));
      const discounts=new Map([...compositions].map(([productId,result])=>[productId,result.selectedDiscount]));
      total=[...compositions.values()].reduce((sum,result)=>sum.add(result.finalLineAmount),new Prisma.Decimal(0)).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
      const discount=subtotal.minus(total).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
      const couponDiscountApplied=[...compositions.values()].reduce((sum,result)=>sum.add(result.couponDiscountAmount),new Prisma.Decimal(0)).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
      const appliedCouponId = campaignAccessCoupon?.id ?? (coupon&&couponDiscountApplied.gt(0)?coupon.id:null);
      const appliedCouponCode = campaignAccessCoupon?.code ?? (coupon&&couponDiscountApplied.gt(0)?coupon.code:null);
      const installmentDecision = await resolveCheckoutCommercialInstallments({
        lines: items.map((item) => {
          const product = productById.get(item.productId)!;
          const offer = product.sellerOffer!;
          return {
            sellerId: offer.sellerId,
            categoryId: offer.catalogProduct.categoryId,
            sellerOfferId: offer.id,
            eligibleAmount: offer.price.mul(item.quantity).minus(discounts.get(product.id) ?? 0),
          };
        }),
        effectiveAt: orderEffectiveAt,
        provider: "TEST",
        requestedInstallmentCount,
        legalConstraint: { status: "UNKNOWN" },
      }, tx);
      const installment = installmentDecision.resolution;
      const orderNumber = `BG-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const orderItemSnapshots = await Promise.all(items.map(async (item) => { const product = productById.get(item.productId)!;const offer=product.sellerOffer!;const composition=compositions.get(product.id)!;const itemDiscount=composition.selectedDiscount; const { money, provenance } = await commissionForCheckoutLine({ sellerId: offer.sellerId, categoryId: offer.catalogProduct.categoryId, effectiveAt: orderEffectiveAt, grossAmount: composition.finalLineAmount }, tx); return { productId: product.id, catalogProductId: offer.catalogProductId, sellerOfferId: offer.id, sellerId: offer.sellerId, productName: product.name, productSku: offer.sellerSku, productImageUrl: product.imageUrl, unitPrice: offer.price, quantity: item.quantity,discountAmount:itemDiscount,baseUnitPrice:composition.baseUnitPrice,campaignApplied:composition.campaignApplied,campaignId:composition.campaignApplied?composition.campaignCandidate!.campaignId:null,campaignVersion:composition.campaignApplied?composition.campaignCandidate!.campaignVersion:null,campaignType:composition.campaignApplied?composition.campaignCandidate!.campaignType:null,campaignDiscountAmount:composition.campaignDiscountAmount,couponApplied:Boolean(campaignAccessCoupon)||composition.couponApplied,couponSnapshotId:campaignAccessCoupon?.id??(composition.couponApplied?composition.couponCandidate!.couponId:null),couponReference:campaignAccessCoupon?.code??(composition.couponApplied?composition.couponCandidate!.couponReference:null),couponDiscountAmount:composition.couponDiscountAmount,compositionMode:composition.compositionMode,discountSource:composition.discountSource,effectiveUnitPrice:composition.effectiveUnitPrice,finalLineAmount:composition.finalLineAmount,pricingEffectiveAt:composition.pricingEffectiveAt, commissionRate: money.rate, commissionAmount: money.commission, sellerNetAmount: money.net, ...provenance, stockReservationState: "RESERVED" as const, statusHistory: { create: { toStatus: "NEW" as const } } }; }));
      let created = await tx.order.create({ data: { userId: session.user.id, clientRequestId, orderNumber, createdAt: orderEffectiveAt, subtotalAmount:subtotal,discountAmount:discount,couponId:appliedCouponId,couponCode:appliedCouponCode,totalAmount: total, walletUse: useWallet === true, rewardUseMaximum: rewardRequested ? useMaximumRewardPoints === true : null, rewardRequestedPoints: rewardRequested ? requestedRewardPoints ?? null : null, ...address, items: { create: orderItemSnapshots } }, include: internalIncludes });
      if(campaignAccessCoupon) await reserveCoupon(tx, { couponCode: campaignAccessCoupon.code, userId: session.user.id, orderId: created.id, idempotencyKey: `checkout:coupon:${clientRequestId}`, effectiveAt: orderEffectiveAt });
      else if(coupon&&couponDiscountApplied.gt(0)){const claimed=await tx.coupon.updateMany({where:{id:coupon.id,active:true,usageCount:coupon.usageCount},data:{usageCount:{increment:1}}});if(!claimed.count)throw new Error("Kupon kullanım limiti eşzamanlı olarak doldu.");await tx.couponRedemption.create({data:{couponId:coupon.id,userId:session.user.id,orderId:created.id,discountAmount:couponDiscountApplied}});}
      if (rewardRequested) {
        const reward = await reserveRewardForCheckout(tx, { userId: session.user.id, orderId: created.id, clientRequestId, eligibleAmount: total, requestedPoints: requestedRewardPoints, useMaximum: useMaximumRewardPoints, effectiveAt: orderEffectiveAt });
        created = { ...created, totalAmount: reward.totalAmount };
      }
      const payment = await tx.payment.create({ data: { orderId: created.id, amount: created.totalAmount, provider: "TEST_PENDING", idempotencyKey: `order:${clientRequestId}:payment`, status: "PENDING", reservationExpiresAt, selectedInstallmentCount: installment.selectedInstallmentCount, installmentPolicySource: installment.commercialProvenance.source, installmentPolicyReference: installment.commercialProvenance.sourceReference, installmentPolicyVersion: installment.commercialProvenance.policyVersion, installmentProvider: installment.providerProvenance.provider, installmentProviderCapabilitySource: installment.providerProvenance.source, installmentProviderCapabilityReference: installment.providerProvenance.sourceReference, installmentCommercialSnapshot: installmentDecision.internalSnapshot, metadata: { note: "Gerçek ödeme sağlayıcısı bağlanmadı." } } });
      if (useWallet === true) {
        const reserved = await reserveWalletForCheckout(tx, { userId: session.user.id, orderId: created.id, paymentId: payment.id, payable: created.totalAmount, currency: "TRY", idempotencyKey: `wallet-reserve:v1:${clientRequestId}`, effectiveAt: orderEffectiveAt });
        const allocationKey = `wallet-allocation:v1:${clientRequestId}`;
        await tx.payment.update({ where: { id: payment.id }, data: { amount: reserved.externalTender, provider: reserved.externalTender.gt(0) ? "TEST_PENDING" : "INTERNAL_WALLET_PENDING" } });
        await tx.order.update({ where: { id: created.id }, data: { walletTenderAmount: reserved.walletTender, externalTenderAmount: reserved.externalTender, tenderCurrency: "TRY" } });
        await tx.walletTenderAllocation.create({ data: { orderId: created.id, paymentId: payment.id, currency: "TRY", totalCustomerPayable: created.totalAmount, walletTenderAmount: reserved.walletTender, externalTenderAmount: reserved.externalTender, walletAccountId: reserved.transaction?.walletAccountId ?? null, walletReservationId: reserved.transaction?.id ?? null, allocationVersion: "WALLET_TENDER_V1", idempotencyKey: allocationKey, semanticHash: semanticHash({ orderId: created.id, paymentId: payment.id, total: created.totalAmount.toFixed(2), wallet: reserved.walletTender.toFixed(2), external: reserved.externalTender.toFixed(2), currency: "TRY" }), effectiveAt: orderEffectiveAt, correlationId: clientRequestId } });
      }
      for (const orderItem of created.items) {
        const grossAmount = orderItem.unitPrice.mul(orderItem.quantity).minus(orderItem.discountAmount);
        const payout = await tx.sellerPayout.create({ data: { sellerId: orderItem.sellerId, orderId: created.id, orderItemId: orderItem.id, grossAmount, commissionAmount: orderItem.commissionAmount ?? 0, providerFeeAmount: 0, netAmount: orderItem.sellerNetAmount ?? grossAmount.minus(orderItem.commissionAmount ?? 0), status: "PENDING" } });
        await tx.financialLedgerEntry.createMany({ data: [
          { sellerId: orderItem.sellerId, orderItemId: orderItem.id, payoutId: payout.id, type: "SALE", amount: grossAmount },
          { sellerId: orderItem.sellerId, orderItemId: orderItem.id, payoutId: payout.id, type: "COMMISSION", amount: orderItem.commissionAmount ?? 0 },
        ] });
      }
      await tx.cartItem.deleteMany({ where: { userId: session.user.id, productId: { in: items.map((item) => item.productId) } } });
      await enqueueNotifications(tx, [{ userId: session.user.id, orderId: created.id, type: "ORDER_CREATED", dedupeKey: `order-created:${created.id}:customer`, title: "Siparişiniz alındı", message: `${created.orderNumber} numaralı siparişiniz oluşturuldu. Ödeme henüz bekliyor.` }]);
      return { id: created.id, orderNumber: created.orderNumber };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return NextResponse.json(order, { status: 201 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Sipariş oluşturulamadı.";
    const prismaError = reason as { code?: string; meta?: unknown };
    console.error("[orders] Sipariş oluşturma hatası", { message, code: prismaError.code, meta: prismaError.meta });
    const serverPolicyFailure = reason instanceof InstallmentPolicyConfigError || reason instanceof ProviderInstallmentCapabilityError || reason instanceof CommercialPolicyError || reason instanceof CheckoutCompositionError;
    const couponMessage: Partial<Record<InstanceType<typeof CouponDomainError>["code"], string>> = { COUPON_CODE_INVALID: "Kupon bulunamadı.", COUPON_REVOKED: "Bu kupon artık aktif değil.", COUPON_INACTIVE: "Bu kupon aktif değil.", COUPON_NOT_STARTED: "Bu kupon henüz kullanıma açılmadı.", COUPON_EXPIRED: "Bu kuponun kullanım süresi doldu.", COUPON_EXHAUSTED: "Bu kuponun kullanım limiti doldu.", COUPON_ALREADY_REDEEMED: "Bu kupon daha önce kullanıldı.", COUPON_USER_LIMIT_REACHED: "Bu kupon için kullanım limitinize ulaştınız.", COUPON_NOT_ELIGIBLE: "Bu kupon bu sipariş için geçerli değil.", COUPON_IDEMPOTENCY_CONFLICT: "Bu sipariş isteği farklı bir kuponla daha önce kullanıldı." };
    const rewardMessage: Partial<Record<InstanceType<typeof RewardDomainError>["code"], string>> = { REWARD_INSUFFICIENT_POINTS: "Yeterli kullanılabilir ödül puanınız yok.", REWARD_NOT_ELIGIBLE: "Ödül puanları bu siparişte kullanılamıyor.", REWARD_REDEEM_LIMIT_EXCEEDED: "Ödül puanı kullanım limitini aştınız.", REWARD_PAYABLE_FLOOR_VIOLATION: "Ödül puanı bu sipariş tutarına uygulanamıyor.", REWARD_IDEMPOTENCY_CONFLICT: "Bu sipariş isteği farklı bir ödül tercihiyle daha önce kullanıldı.", REWARD_POLICY_NOT_EFFECTIVE: "Ödül puanı politikası şu anda geçerli değil.", REWARD_STATE_CHANGED: "Ödül puanı bakiyeniz değişti; lütfen yeniden deneyin." };
    const safeMessage = reason instanceof CouponDomainError ? couponMessage[reason.code] ?? "Kupon kullanılamadı." : reason instanceof RewardDomainError ? rewardMessage[reason.code] ?? "Ödül puanları kullanılamadı." : reason instanceof StoredValueDomainError ? "Cüzdan kullanılamadı; lütfen tekrar deneyin." : /stok|satışta değil|kupon|sepet tutarı/i.test(message) ? message : "Sipariş işlemi tamamlanamadı. Lütfen tekrar deneyin.";
    return NextResponse.json({ error: safeMessage }, { status: serverPolicyFailure ? 500 : 409 });
  }
}
