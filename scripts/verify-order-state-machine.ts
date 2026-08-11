import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type OrderStatus } from "@prisma/client";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Veritabanı bağlantısı yapılandırılmamış.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prefix = "e2e-final-qa-";
const marker = `[E2E FINAL QA]`;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function aggregate(statuses: OrderStatus[]): OrderStatus {
  const active = statuses.filter((status) => status !== "CANCELLED");
  if (!active.length) return "CANCELLED";
  if (active.every((status) => status === "DELIVERED" || status === "COMPLETED")) return "DELIVERED";
  if (active.some((status) => ["SHIPPED", "DELIVERED", "COMPLETED"].includes(status))) return "SHIPPED";
  if (active.some((status) => status === "READY_TO_SHIP")) return "READY_TO_SHIP";
  if (active.some((status) => status === "PREPARING")) return "PREPARING";
  return "NEW";
}
async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: prefix, endsWith: "@invalid.local" } }, select: { id: true } });
  if (!users.length) return;
  const userIds = users.map((user) => user.id);
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
async function transition(itemId: string, sellerId: string, target: OrderStatus, shippingCompany?: string, trackingNumber?: string) {
  await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({ where: { id: itemId, sellerId }, select: { id: true, orderId: true, status: true } });
    assert(item, "Seller isolation failed: owner cannot find order item.");
    const allowed: Partial<Record<OrderStatus, OrderStatus[]>> = { NEW: ["PREPARING"], PREPARING: ["READY_TO_SHIP"], READY_TO_SHIP: ["SHIPPED"], SHIPPED: ["DELIVERED"] };
    assert(allowed[item.status]?.includes(target), `Invalid transition accepted: ${item.status} -> ${target}`);
    if (target === "SHIPPED") assert(shippingCompany?.trim() && trackingNumber?.trim(), "Shipping validation failed.");
    await tx.orderItem.update({ where: { id: item.id }, data: { status: target, ...(target === "SHIPPED" ? { shippingCompany: shippingCompany!.trim(), trackingNumber: trackingNumber!.trim() } : {}) } });
    await tx.orderStatusHistory.create({ data: { orderItemId: item.id, fromStatus: item.status, toStatus: target } });
    const statuses = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } });
    await tx.order.update({ where: { id: item.orderId }, data: { status: aggregate(statuses.map((entry) => entry.status)) } });
  });
}

async function main() {
  await cleanup();
  try {
    const suffix = crypto.randomUUID().slice(0, 12);
    const password = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const sellerA = await prisma.user.create({ data: { name: "E2E", surname: "Satıcı A", email: `${prefix}seller-a-${suffix}@invalid.local`, phone: "0000000000", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: `${marker} Satıcı A`, storeSlug: `${prefix}a-${suffix}`, companyType: "TEST", taxNumber: `QA-A-${suffix}`, taxOffice: "Test", city: "İstanbul", address: "Geçici QA kaydı", description: "Otomatik QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
    const sellerB = await prisma.user.create({ data: { name: "E2E", surname: "Satıcı B", email: `${prefix}seller-b-${suffix}@invalid.local`, phone: "0000000000", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: `${marker} Satıcı B`, storeSlug: `${prefix}b-${suffix}`, companyType: "TEST", taxNumber: `QA-B-${suffix}`, taxOffice: "Test", city: "İzmir", address: "Geçici QA kaydı", description: "Otomatik QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
    const customer = await prisma.user.create({ data: { name: "E2E", surname: "Müşteri", email: `${prefix}customer-${suffix}@invalid.local`, phone: "0000000000", passwordHash } });
    assert(await bcrypt.compare(password, customer.passwordHash), "Customer credential hash smoke test failed.");
    assert(await bcrypt.compare(password, sellerA.passwordHash), "Seller credential hash smoke test failed.");
    const product = await prisma.product.create({ data: { sellerId: sellerA.sellerProfile!.id, name: `${marker} Spin Olta`, slug: `${prefix}spin-${suffix}`, category: "Olta Makineleri", brand: "BalıkGo QA", price: 100, stock: 5, description: "Otomatik final QA ürünü", imageUrl: "/products/spin-olta-seti.jpg", images: ["/products/spin-olta-seti.jpg"], active: true } });
    const catalog = await prisma.product.findMany({ where: { id: product.id, active: true, seller: { status: "APPROVED" } }, include: { seller: true } });
    assert(catalog.length === 1 && catalog[0].sellerId === sellerA.sellerProfile!.id, "Product listing/detail seller relation failed.");
    const category = await prisma.product.findMany({ where: { category: "Olta Makineleri", id: product.id, active: true } }); assert(category.length === 1, "Category filtering failed.");
    await prisma.cartItem.upsert({ where: { userId_productId: { userId: customer.id, productId: product.id } }, create: { userId: customer.id, productId: product.id, quantity: 2 }, update: { quantity: 2 } });
    await prisma.favorite.upsert({ where: { userId_productId: { userId: customer.id, productId: product.id } }, create: { userId: customer.id, productId: product.id }, update: {} });
    await prisma.favorite.upsert({ where: { userId_productId: { userId: customer.id, productId: product.id } }, create: { userId: customer.id, productId: product.id }, update: {} });
    assert(await prisma.cartItem.count({ where: { userId: customer.id, productId: product.id, quantity: 2 } }) === 1, "Cart persistence failed.");
    assert(await prisma.favorite.count({ where: { userId: customer.id, productId: product.id } }) === 1, "Favorite uniqueness/persistence failed.");
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findFirstOrThrow({ where: { id: product.id, active: true }, include: { seller: true } });
      const changed = await tx.product.updateMany({ where: { id: current.id, active: true, stock: { gte: 2 } }, data: { stock: { decrement: 2 } } }); assert(changed.count === 1, "Checkout stock guard failed.");
      const result = await tx.order.create({ data: { userId: customer.id, orderNumber: `E2E-${suffix}`, clientRequestId: crypto.randomUUID(), totalAmount: 200, recipientName: "E2E Müşteri", phone: "0000000000", city: "İstanbul", district: "Kadıköy", address: "Geçici QA teslimat adresi", items: { create: { productId: current.id, sellerId: current.sellerId, productName: current.name, productImageUrl: current.imageUrl, unitPrice: current.price, quantity: 2, statusHistory: { create: { toStatus: "NEW" } } } } }, include: { items: true } });
      await tx.cartItem.deleteMany({ where: { userId: customer.id, productId: current.id } }); return result;
    });
    const itemId = order.items[0].id;
    const created = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { statusHistory: true } } } });
    assert(created.items[0].sellerId === sellerA.sellerProfile!.id && created.items[0].status === "NEW" && created.items[0].statusHistory.length === 1, "Checkout, seller assignment or initial history failed.");
    assert(await prisma.product.findUniqueOrThrow({ where: { id: product.id }, select: { stock: true } }).then((entry) => entry.stock === 3), "Stock decrement failed.");
    assert(await prisma.cartItem.count({ where: { userId: customer.id } }) === 0, "Cart clear after checkout failed.");
    assert(await prisma.order.count({ where: { userId: customer.id } }) === 1, "Customer order list visibility failed.");
    assert(await prisma.product.count({ where: { sellerId: sellerA.sellerProfile!.id } }) === 1, "Seller products visibility failed.");
    assert(await prisma.orderItem.count({ where: { id: itemId, sellerId: sellerA.sellerProfile!.id } }) === 1, "Correct seller order visibility failed.");
    assert(await prisma.orderItem.count({ where: { id: itemId, sellerId: sellerB.sellerProfile!.id } }) === 0, "Seller isolation failed.");
    for (const [target, company, tracking] of [["PREPARING"], ["READY_TO_SHIP"], ["SHIPPED", "Yurtiçi Kargo", "E2E-123456"], ["DELIVERED"]] as const) {
      await transition(itemId, sellerA.sellerProfile!.id, target, company, tracking);
      const persisted = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId }, include: { order: true, statusHistory: true } });
      assert(persisted.status === target, `OrderItem persistence failed at ${target}.`); assert(persisted.order.status === (target === "DELIVERED" ? "DELIVERED" : target), `Order aggregate persistence failed at ${target}.`);
      if (target === "SHIPPED") assert(persisted.shippingCompany === "Yurtiçi Kargo" && persisted.trackingNumber === "E2E-123456", "Shipping persistence failed.");
    }
    const tracked = await prisma.order.findFirstOrThrow({ where: { id: order.id, userId: customer.id }, include: { items: true } }); assert(tracked.items[0].status === "DELIVERED" && tracked.items[0].shippingCompany === "Yurtiçi Kargo" && tracked.items[0].trackingNumber === "E2E-123456", "Customer tracking synchronization failed.");
    console.log("PASS: final QA smoke/integration: credentials, catalog/detail/category, cart/favorite, checkout, stock, seller assignment/isolation, customer/seller visibility, state machine, shipping and customer tracking.");
  } finally { await cleanup(); await prisma.$disconnect(); }
}
main().catch((error) => { console.error("FAIL:", error instanceof Error ? error.message : error); process.exitCode = 1; });
