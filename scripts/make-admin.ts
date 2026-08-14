import "dotenv/config";
import { createGuardedOperationPrisma } from "./guarded-operation-prisma";

const email = process.argv[2]?.normalize("NFKC").trim().toLocaleLowerCase("tr-TR");
if (!email) throw new Error("Kullanım: npm run make-admin -- email@example.com");
const prisma = createGuardedOperationPrisma("make-admin", "write");

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
