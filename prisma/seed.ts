import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { products } from "../app/lib/products";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("A database connection is required to seed products.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const seedUser = await prisma.user.upsert({
    where: { email: "satici@balikgo.local" },
    update: {},
    create: {
      name: "BalıkGo",
      surname: "Mağazası",
      email: "satici@balikgo.local",
      phone: "0000000000",
      passwordHash: await hash("seed-account-not-for-login", 12),
      role: "SELLER",
    },
  });

  const seller = await prisma.sellerProfile.upsert({
    where: { userId: seedUser.id },
    update: { storeSlug: "balikgo-magazasi", phone: "0000000000", categories: "Olta Kamışları, Olta Makineleri, Misina, Yem ve Sahte" },
    create: {
      userId: seedUser.id,
      storeName: "BalıkGo Mağazası",
      storeSlug: "balikgo-magazasi",
      companyType: "Şahıs Şirketi",
      phone: "0000000000",
      taxNumber: "0000000000",
      taxOffice: "Merkez",
      city: "İstanbul",
      address: "BalıkGo örnek mağaza adresi",
      description: "Balıkçılık ekipmanları için BalıkGo örnek mağazası.",
      categories: "Olta Kamışları, Olta Makineleri, Misina, Yem ve Sahte",
      status: "APPROVED",
    },
  });

  for (const product of products) {
    const oldPrice = Number(product.oldPrice.replace(/[^0-9,]/g, "").replace(",", "."));

    await prisma.product.upsert({
      where: { slug: product.id },
      update: {
        name: product.name,
        category: product.category,
        brand: product.brand,
        price: product.unitPrice,
        oldPrice,
        description: product.shortDescription,
        imageUrl: product.image,
        badge: product.badge,
        discount: product.discount,
        rating: product.rating,
        reviewCount: product.reviewCount,
        active: true,
      },
      create: {
        id: product.id,
        sellerId: seller.id,
        name: product.name,
        slug: product.id,
        category: product.category,
        brand: product.brand,
        price: product.unitPrice,
        oldPrice,
        stock: 20,
        description: product.shortDescription,
        imageUrl: product.image,
        badge: product.badge,
        discount: product.discount,
        rating: product.rating,
        reviewCount: product.reviewCount,
      },
    });
  }

  console.log(`${products.length} ürün veritabanına eklendi veya güncellendi.`);
}

main()
  .finally(() => prisma.$disconnect());
