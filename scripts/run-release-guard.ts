import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { validateTestDatabaseEnvironment } from "./guarded-test-prisma.ts";
import { fullReadinessDecision, releaseDecision, runCommandGate, writeReport, type CommandGate, type FailureClassification, type GateResult } from "./release-guard-core.ts";

const root = resolve(import.meta.dirname, "..");
const profileArg = process.argv.find((value) => value.startsWith("--profile="))?.split("=", 2)[1] ?? "fast";
if (profileArg !== "fast" && profileArg !== "full") throw new Error("PROFILE_MUST_BE_FAST_OR_FULL");
const profile = profileArg;
const reportPath = resolve(root, process.argv.find((value) => value.startsWith("--report="))?.split("=", 2)[1] ?? ".release-guard/report.json");
const node = process.execPath;
const preload = "data:text/javascript,import%20os%20from%20'node%3Aos'%3Bos.userInfo%3D()%3D%3E(%7Busername%3A'qa'%2Chomedir%3Aprocess.cwd()%2Cshell%3Anull%2Cuid%3A-1%2Cgid%3A-1%7D)%3B";
const nodeTs = (script: string, envFile = false) => [node, [...(envFile ? ["--env-file=.env"] : []), "--conditions=react-server", "--import", preload, "--import", "tsx", script]] as const;
const nodeStrip = (script: string) => [node, ["--experimental-strip-types", script]] as const;
const git = "git";

function localSecret(name: string) {
  try { const line = readFileSync(resolve(root, ".env.test.local"), "utf8").split(/\r?\n/).find((value) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(value)); if (!line) return ""; const raw = line.slice(line.indexOf("=") + 1).trim(); return ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) ? raw.slice(1, -1) : raw; } catch { return ""; }
}

async function fullPrecheck(password: string): Promise<{ result: GateResult; ready: boolean }> {
  const started = performance.now();
  let databaseError: string | undefined; try { validateTestDatabaseEnvironment({ DATABASE_URL: process.env.DATABASE_URL, SUPABASE_CA_CERT_PATH: process.env.SUPABASE_CA_CERT_PATH }); } catch (error) { databaseError = error instanceof Error ? error.message : "DATABASE_GUARD_FAILED"; }
  const ignored = await runCommandGate({ name: "local-secret-ignore", group: "SECURITY", command: git, args: ["check-ignore", "-q", ".env.test.local"], timeoutMs: 10_000, classification: "SECURITY_FAILURE" }, { cwd: root, secrets: [password, process.env.DATABASE_URL ?? ""] });
  const decision = fullReadinessDecision({ databaseError, caExists: Boolean(process.env.SUPABASE_CA_CERT_PATH && existsSync(process.env.SUPABASE_CA_CERT_PATH)), passwordLength: password.length, localSecretIgnored: ignored.status === "PASS" });
  return { ready: decision.ready, result: { name: "full-environment", group: "SECURITY", status: decision.status, blocking: true, durationMs: Math.round(performance.now() - started), ...(!decision.ready ? { classification: decision.classification, reason: decision.reason } : {}) } };
}

async function freePort() { return await new Promise<number>((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolvePort(port)); }); }); }
async function stopServer(server: ChildProcess | null) { if (!server || server.exitCode !== null) return; server.kill(); await Promise.race([new Promise<void>((resolveExit) => server.once("exit", () => resolveExit())), new Promise<void>((resolveWait) => setTimeout(resolveWait, 5_000))]); }
async function runtimeGates(password: string, fullReady: boolean): Promise<GateResult[]> {
  if (!fullReady) return ["checkout-api", "shipping-runtime"].map((name) => ({ name, group: name === "checkout-api" ? "ORDER_SAFETY" : "SHIPMENT_SAFETY", status: "SKIPPED", blocking: true, durationMs: 0, reason: "FULL_ENVIRONMENT_NOT_READY" }));
  const started = performance.now(); let server: ChildProcess | null = null;
  try {
    const port = await freePort(); const baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(node, [resolve(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: root, env: process.env, shell: false, windowsHide: true, stdio: "ignore" });
    for (let attempt = 0; attempt < 60; attempt++) { if (server.exitCode !== null) throw new Error("LOCAL_SERVER_EXITED"); try { if ((await fetch(`${baseUrl}/api/auth/csrf`)).ok) break; } catch {} if (attempt === 59) throw new Error("LOCAL_SERVER_READINESS_TIMEOUT"); await new Promise((resolveWait) => setTimeout(resolveWait, 250)); }
    const runtimeEnv = { ...process.env, QA_BASE_URL: baseUrl, QA_SHIPPING_PASSWORD: password }; const results: GateResult[] = [];
    for (const [name, group, script, timeoutMs] of [["checkout-api", "ORDER_SAFETY", "scripts/verify-checkout-api.ts", 300_000], ["shipping-runtime", "SHIPMENT_SAFETY", "scripts/verify-shipping-runtime.ts", 600_000]] as const) {
      const [command, args] = nodeTs(script, true); results.push(await runCommandGate({ name, group, command, args: [...args], timeoutMs, env: runtimeEnv, classification: "TEST_FAILURE" }, { cwd: root, secrets: [password, process.env.DATABASE_URL ?? ""] }));
    }
    return results;
  } catch (error) { return [{ name: "local-server", group: "SECURITY", status: "BLOCKED", blocking: true, durationMs: Math.round(performance.now() - started), classification: "INFRA_BLOCKED", reason: error instanceof Error ? error.message : "SERVER_START_FAILED" }]; }
  finally { await stopServer(server); }
}

const command = (name: string, group: string, tuple: readonly [string, readonly string[]], timeoutMs: number, classification: FailureClassification = "TEST_FAILURE", blocking = true): CommandGate => ({ name, group, command: tuple[0], args: [...tuple[1]], timeoutMs, classification, blocking });
const gates: CommandGate[] = [
  command("db-guard", "SECURITY", nodeStrip("scripts/verify-test-db-guard.ts"), 30_000, "SECURITY_FAILURE"),
  command("operation-guards", "SECURITY", nodeStrip("scripts/verify-operation-guards.ts"), 30_000, "SECURITY_FAILURE"),
  command("transaction-guardian", "TRANSACTION_SAFETY", nodeStrip("scripts/verify-transaction-guardian.ts"), 30_000),
  command("cancellation-orchestration", "TRANSACTION_SAFETY", nodeStrip("scripts/verify-cancellation-orchestration-v1.ts"), 30_000),
  command("stock-truth", "INVENTORY_SAFETY", nodeStrip("scripts/verify-stock-truth.ts"), 30_000),
  command("stock-reservation", "INVENTORY_SAFETY", nodeStrip("scripts/verify-stock-reservation.ts"), 30_000),
  command("buybox", "ORDER_SAFETY", nodeStrip("scripts/verify-buybox.ts"), 30_000),
  command("shipping-contract", "SHIPMENT_SAFETY", nodeTs("scripts/verify-shipping.ts"), 30_000),
  command("shipment-orchestration", "SHIPMENT_SAFETY", nodeTs("scripts/verify-shipment-orchestration-v1.ts"), 30_000),
  command("typescript", "CODE_QUALITY", [node, [resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit"]], 120_000, "CODE_REGRESSION"),
  command("lint", "CODE_QUALITY", [node, [resolve(root, "node_modules/eslint/bin/eslint.js"), "."]], 120_000, "CODE_REGRESSION"),
  command("build", "CODE_QUALITY", [node, [resolve(root, "node_modules/next/dist/bin/next"), "build"]], 300_000, "BUILD_FAILURE"),
  command("diff-check", "CODE_QUALITY", [git, ["diff", "--check"]], 30_000, "CODE_REGRESSION"),
];

async function main() {
  const startedAt = new Date().toISOString(); const started = performance.now(); const password = process.env.QA_SHIPPING_PASSWORD ?? localSecret("QA_SHIPPING_PASSWORD"); const secrets = [password, process.env.DATABASE_URL ?? ""];
  const results: GateResult[] = [];
  for (const gate of gates) { const result = await runCommandGate(gate, { cwd: root, secrets }); results.push(result); console.log(`${result.status.padEnd(7)} ${result.group}/${result.name} (${result.durationMs}ms)`); if (result.reason && result.status !== "PASS") console.log(`         ${result.classification ?? ""}: ${result.reason}`); }
  let fullReady = false;
  if (profile === "full") {
    const precheck = await fullPrecheck(password); fullReady = precheck.ready; results.push(precheck.result); console.log(`${precheck.result.status.padEnd(7)} SECURITY/full-environment (${precheck.result.durationMs}ms)`);
    const fullGates = [
      command("transaction-guardian-db", "TRANSACTION_SAFETY", nodeTs("scripts/test-transaction-guardian-db-e2e.ts", true), 900_000),
      command("stock-truth-db", "INVENTORY_SAFETY", nodeTs("scripts/test-stock-truth-db-e2e.ts", true), 300_000),
      command("stock-reservation-db", "INVENTORY_SAFETY", nodeTs("scripts/test-stock-reservation-db-e2e.ts", true), 600_000),
      command("finance-invariants", "TRANSACTION_SAFETY", nodeTs("scripts/verify-finance-invariants.ts", true), 180_000),
      command("order-state-machine", "ORDER_SAFETY", nodeTs("scripts/verify-order-state-machine.ts", true), 300_000),
    ];
    for (const gate of fullGates) { if (!fullReady) gate.skip = "FULL_ENVIRONMENT_NOT_READY"; const result = await runCommandGate(gate, { cwd: root, secrets }); results.push(result); console.log(`${result.status.padEnd(7)} ${result.group}/${result.name} (${result.durationMs}ms)`); }
    const runtimeResults = await runtimeGates(password, fullReady); for (const runtime of runtimeResults) { results.push(runtime); console.log(`${runtime.status.padEnd(7)} ${runtime.group}/${runtime.name} (${runtime.durationMs}ms)`); }
  }
  const report = releaseDecision(profile, startedAt, Math.round(performance.now() - started), results); await writeReport(reportPath, report);
  console.log(`\n${report.decision} (${profile.toUpperCase()})`); console.log(`Report: ${reportPath.replace(root, ".")}`); process.exitCode = report.overall === "PASS" ? 0 : 1;
}
void main().catch((error) => { console.error("RELEASE_BLOCKED", error instanceof Error ? error.message : "UNKNOWN"); process.exitCode = 1; });
