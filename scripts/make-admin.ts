import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.normalize("NFKC").trim().toLocaleLowerCase("tr-TR");
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!email) throw new Error("Kullanım: npm run make-admin -- email@example.com");
if (!connectionString) throw new Error("Veritabanı bağlantısı yapılandırılmamış.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) throw new Error("Bu e-posta ile kayıtlı kullanıcı bulunamadı.");
  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  console.log("Kullanıcı ADMIN rolüne yükseltildi.");
}
main().finally(() => prisma.$disconnect());
