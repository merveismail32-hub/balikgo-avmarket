import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { guardedTestConnectionOptions, TEST_DB_IDENTITY } from "./guarded-test-prisma";

const connection = guardedTestConnectionOptions();
const connectionString = connection.connectionString;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const target = new URL(connectionString);
const ssl = connection.ssl;
const fields = {
  host: target.hostname,
  user: decodeURIComponent(target.username),
  password: decodeURIComponent(target.password),
  port: Number(target.port),
  database: TEST_DB_IDENTITY.database,
  ssl,
};

function errorClass(error: unknown) {
  const codes = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || typeof value !== "object" || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
      if (["code", "originalCode", "sqlState"].includes(key) && typeof nested === "string") codes.add(nested);
      else if (!["message", "stack", "query", "args"].includes(key)) visit(nested, depth + 1);
    }
  };
  visit(error, 0);
  if (codes.size) return [...codes].join("/");
  return error instanceof Error ? error.name : "UNKNOWN";
}

async function verifyPg(label: string, client: Client) {
  try {
    await client.connect();
    const result = await client.query<{ database: string; role: string }>("select current_database() as database, current_user as role");
    assert(result.rows[0]?.database === "postgres" && result.rows[0]?.role === "postgres", "SERVER_IDENTITY_MISMATCH");
    console.log(`PASS: ${label}`);
    return true;
  } catch (error) {
    console.log(`FAIL: ${label} [${errorClass(error)}]`);
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function verifyPrisma() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl }) });
  try {
    const rows = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() as database, current_user as role`;
    assert(rows[0]?.database === "postgres" && rows[0]?.role === "postgres", "SERVER_IDENTITY_MISMATCH");
    console.log("PASS: PrismaPg secure connection");
    return true;
  } catch (error) {
    console.log(`FAIL: PrismaPg secure connection [${errorClass(error)}]`);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const results = [
    await verifyPg("pg connectionString", new Client({ connectionString, ssl })),
    await verifyPg("pg parsed fields", new Client(fields)),
    await verifyPrisma(),
  ];
  if (results.some((passed) => !passed)) process.exitCode = 1;
}

void main();
