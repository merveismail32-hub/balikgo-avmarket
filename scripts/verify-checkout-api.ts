import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.QA_BASE_URL ?? "http://localhost:3000";
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Veritabanı bağlantısı yapılandırılmamış.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prefix = "e2e-checkout-api-";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function cookieValues(response: Response) { const headers = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""]; return headers.map((header) => header.split(";")[0]).filter(Boolean); }
async function cleanup() { const users = await prisma.user.findMany({ where: { email: { startsWith: prefix, endsWith: "@invalid.local" } }, select: { id: true, sellerProfile: { select: { id: true, products: { select: { catalogProductId: true } } } } } }); const ids = users.map((user) => user.id); const sellerIds = users.flatMap((user) => user.sellerProfile ? [user.sellerProfile.id] : []); const catalogIds = [...new Set(users.flatMap((user) => user.sellerProfile?.products.map((product) => product.catalogProductId).filter((id): id is string => Boolean(id)) ?? []))]; if (ids.length) { await prisma.order.deleteMany({ where: { userId: { in: ids } } }); if (sellerIds.length) await prisma.sellerOffer.deleteMany({ where: { sellerId: { in: sellerIds } } }); await prisma.user.deleteMany({ where: { id: { in: ids } } }); if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds }, offers: { none: {} } } }); } }
async function main() {
  await cleanup();
  try {
    const suffix = crypto.randomUUID().slice(0, 10); const password = crypto.randomUUID(); const passwordHash = await bcrypt.hash(password, 12);
    const seller = await prisma.user.create({ data: { name: "QA", surname: "Seller", email: `${prefix}seller-${suffix}@invalid.local`, phone: "0000000000", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: "E2E Checkout Seller", storeSlug: `${prefix}store-${suffix}`, companyType: "TEST", taxNumber: `QA-${suffix}`, taxOffice: "Test", city: "İstanbul", address: "Geçici test", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
    const customer = await prisma.user.create({ data: { name: "QA", surname: "Customer", email: `${prefix}customer-${suffix}@invalid.local`, phone: "0000000000", passwordHash } });
    const catalog = await prisma.catalogProduct.create({ data: { slug: `${prefix}catalog-${suffix}`, identityKey: `QA-BUYBOX-${suffix}`, name: "E2E Checkout Product", category: "Olta Makineleri", brand: "QA", description: "Geçici checkout API test ürünü", imageUrl: "/products/olta-makinesi.jpg" } });
    const product = await prisma.product.create({ data: { sellerId: seller.sellerProfile!.id, catalogProductId: catalog.id, name: catalog.name, slug: `${prefix}product-${suffix}`, category: catalog.category, brand: catalog.brand, price: 100, stock: 4, description: catalog.description, imageUrl: catalog.imageUrl, active: true } });
    const offer = await prisma.sellerOffer.create({ data: { sellerId: seller.sellerProfile!.id, catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: `QA-${suffix}`, price: 100, stock: 4 } });
    await prisma.cartItem.create({ data: { userId: customer.id, productId: product.id, catalogProductId: catalog.id, sellerOfferId: offer.id, quantity: 1 } });
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`); assert(csrfResponse.ok, "CSRF endpoint başarısız."); const csrf = await csrfResponse.json() as { csrfToken?: string }; assert(csrf.csrfToken, "CSRF token alınamadı."); const cookies = cookieValues(csrfResponse);
    const login = await fetch(`${baseUrl}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies.join("; ") }, body: new URLSearchParams({ csrfToken: csrf.csrfToken!, email: customer.email, password, callbackUrl: `${baseUrl}/checkout`, json: "true" }) });
    cookies.push(...cookieValues(login)); assert(login.status === 200 || login.status === 302, `Credentials login başarısız: HTTP ${login.status}`); assert(cookies.some((cookie) => /authjs\.session-token|next-auth\.session-token/.test(cookie)), "Oturum çerezi oluşturulmadı.");
    const address = { recipientName: "QA Customer", phone: "05000000000", city: "İstanbul", district: "Kadıköy", address: "Geçici otomatik checkout test adresi", postalCode: "34000" };
    const mismatched = await fetch(`${baseUrl}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies.join("; ") }, body: JSON.stringify({ clientRequestId: crypto.randomUUID(), address, items: [{ productId: product.id, catalogProductId: catalog.id, sellerOfferId: "foreign-offer", quantity: 1 }] }) });
    assert(mismatched.status === 409 && (await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).stock === 4, "Catalog/offer mismatch was not rejected before stock mutation.");
    const injectedAuthority = await fetch(`${baseUrl}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies.join("; ") }, body: JSON.stringify({ clientRequestId: crypto.randomUUID(), address, items: [{ productId: product.id, quantity: 1, price: 1, sellerId: "attacker-selected" }] }) });
    assert(injectedAuthority.status === 400 && (await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).stock === 4, "Client price/seller authority fields were accepted.");
    const orderResponse = await fetch(`${baseUrl}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies.join("; ") }, body: JSON.stringify({ clientRequestId: crypto.randomUUID(), address, items: [{ productId: product.id, catalogProductId: catalog.id, sellerOfferId: offer.id, quantity: 1 }] }) });
    const orderBody = await orderResponse.json() as { id?: string; error?: string }; assert(orderResponse.status === 201 && orderBody.id, `Checkout API başarısız: ${orderBody.error ?? `HTTP ${orderResponse.status}`}`);
    const customerOrdersResponse = await fetch(`${baseUrl}/api/orders`, { headers: { Cookie: cookies.join("; ") } });
    const customerOrders = await customerOrdersResponse.json() as Array<{ id: string; items: Array<Record<string, unknown>> }>;
    assert(customerOrdersResponse.ok && customerOrders.length > 0, "Customer order list API başarısız.");
    const internalFinanceFields = ["commissionRate", "commissionAmount", "sellerNetAmount", "payout", "ledgerEntries"];
    assert(internalFinanceFields.every((field) => !(field in customerOrders[0].items[0])), "Customer order list seller finans alanı sızdırıyor.");
    const customerOrderDetailResponse = await fetch(`${baseUrl}/api/orders/${orderBody.id}`, { headers: { Cookie: cookies.join("; ") } });
    const customerOrderDetail = await customerOrderDetailResponse.json() as { items?: Array<Record<string, unknown>> };
    assert(customerOrderDetailResponse.ok && customerOrderDetail.items?.length, "Customer order detail API başarısız.");
    assert(internalFinanceFields.every((field) => !(field in customerOrderDetail.items![0])), "Customer order detail seller finans alanı sızdırıyor.");
    const persisted = await prisma.order.findUniqueOrThrow({ where: { id: orderBody.id }, include: { items: { include: { statusHistory: true, payout: true } }, payment: true } }); const item = persisted.items[0]; assert(item.sellerId === seller.sellerProfile!.id && item.status === "NEW" && item.statusHistory.some((entry) => entry.toStatus === "NEW"), "Sipariş/satıcı/history kalıcılığı başarısız."); assert(persisted.payment?.status === "PENDING" && persisted.payment.amount.toString() === "100", "Payment kalıcılığı başarısız."); assert(item.payout?.status === "PENDING" && item.payout.netAmount.toString() === "90", "Hakediş/komisyon kalıcılığı başarısız."); assert(await prisma.financialLedgerEntry.count({ where: { orderItemId: item.id } }) === 2, "Ledger kalıcılığı başarısız."); assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === 3, "Stok düşümü başarısız."); assert(await prisma.cartItem.count({ where: { userId: customer.id } }) === 0, "Başarılı checkout sonrası sepet temizlenmedi.");
    assert(Boolean(item.catalogProductId && item.sellerOfferId), "OrderItem catalog/offer references were not persisted.");
    assert((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: item.sellerOfferId! } })).stock === 3, "SellerOffer atomic stock decrement failed.");
    await prisma.$transaction([prisma.sellerOffer.update({ where: { id: offer.id }, data: { stock: 1 } }), prisma.product.update({ where: { id: product.id }, data: { stock: 1 } })]);
    const concurrentPayload = () => JSON.stringify({ clientRequestId: crypto.randomUUID(), address, items: [{ productId: product.id, catalogProductId: catalog.id, sellerOfferId: offer.id, quantity: 1 }] });
    const concurrent = await Promise.all([1, 2].map(() => fetch(`${baseUrl}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies.join("; ") }, body: concurrentPayload() })));
    assert(concurrent.map((response) => response.status).sort().join(",") === "201,409", "Concurrent last-item checkout did not produce exactly one success.");
    assert((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).stock === 0, "Concurrent checkout oversold SellerOffer stock.");
    console.log("PASS: authenticated offer-aware checkout, mismatch/tamper rejection, authoritative price/seller/stock, snapshots and cart persistence verified.");
  } finally { await cleanup(); await prisma.$disconnect(); }
}
main().catch((error) => { console.error("FAIL:", error instanceof Error ? error.message : error); process.exitCode = 1; });
