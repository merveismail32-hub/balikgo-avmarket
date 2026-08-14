import "server-only";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Runtime trafiğinde pooler bağlantısını kullan; doğrudan bağlantı yalnızca geriye dönük fallback'tir.
  const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!connectionString) {
    throw new Error("A database connection is not configured.");
  }
  const target = new URL(connectionString);
  const caPath = process.env.SUPABASE_CA_CERT_PATH;
  if (target.hostname.endsWith(".supabase.com") && !caPath) {
    throw new Error("SUPABASE_CA_CERT_PATH is required for Supabase database connections.");
  }
  const ssl = caPath ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true } : undefined;

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, ssl }),
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
