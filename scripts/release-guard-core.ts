import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

export type GateStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
export type FailureClassification = "CODE_REGRESSION" | "TEST_FAILURE" | "INFRA_BLOCKED" | "SECRET_MISSING" | "DB_GUARD_FAILURE" | "BUILD_FAILURE" | "SECURITY_FAILURE" | "UNKNOWN";
export type GateResult = { name: string; group: string; status: GateStatus; durationMs: number; blocking: boolean; classification?: FailureClassification; reason?: string };
export type GuardReport = { profile: "fast" | "full"; overall: "PASS" | "FAIL"; decision: "RELEASE_ALLOWED" | "RELEASE_BLOCKED"; startedAt: string; durationMs: number; gates: GateResult[]; releaseSafety?: unknown };
export type CommandGate = { name: string; group: string; command: string; args: string[]; blocking?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv; classification?: FailureClassification; skip?: string; blocked?: { reason: string; classification: FailureClassification } };

export function fullReadinessDecision(input: { databaseError?: string; caExists: boolean; passwordLength: number; localSecretIgnored: boolean }) {
  if (input.databaseError) return { ready: false, status: "FAIL" as const, classification: "DB_GUARD_FAILURE" as const, reason: input.databaseError };
  if (!input.caExists) return { ready: false, status: "BLOCKED" as const, classification: "INFRA_BLOCKED" as const, reason: "TEST_CA_FILE_MISSING" };
  if (input.passwordLength < 8) return { ready: false, status: "BLOCKED" as const, classification: "SECRET_MISSING" as const, reason: "QA_SHIPPING_PASSWORD_MISSING_OR_TOO_SHORT" };
  if (!input.localSecretIgnored) return { ready: false, status: "FAIL" as const, classification: "SECURITY_FAILURE" as const, reason: "LOCAL_TEST_SECRET_FILE_NOT_IGNORED" };
  return { ready: true, status: "PASS" as const };
}

const MAX_CAPTURE = 64 * 1024;
export function redact(text: string, secrets: string[]) {
  let safe = text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]");
  for (const secret of secrets.filter((value) => value.length >= 4)) safe = safe.replaceAll(secret, "[REDACTED]");
  return safe;
}

export async function runCommandGate(gate: CommandGate, options: { cwd: string; secrets: string[] }): Promise<GateResult> {
  const started = performance.now(); const blocking = gate.blocking !== false;
  if (gate.skip) return { name: gate.name, group: gate.group, status: "SKIPPED", durationMs: 0, blocking, reason: gate.skip };
  if (gate.blocked) return { name: gate.name, group: gate.group, status: "BLOCKED", durationMs: 0, blocking, ...gate.blocked };
  return await new Promise((resolve) => {
    let output = ""; let settled = false; let timedOut = false;
    const child = spawn(gate.command, gate.args, { cwd: options.cwd, env: gate.env ?? process.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-MAX_CAPTURE); };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, gate.timeoutMs ?? 120_000);
    const finish = (status: GateStatus, classification?: FailureClassification, reason?: string) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      resolve({ name: gate.name, group: gate.group, status, durationMs: Math.round(performance.now() - started), blocking, classification, reason: reason ? redact(reason, options.secrets).slice(-2000) : undefined });
    };
    child.on("error", (error) => finish("BLOCKED", "INFRA_BLOCKED", error.name));
    child.on("exit", (code, signal) => {
      if (timedOut) return finish("BLOCKED", "INFRA_BLOCKED", `TIMEOUT_${gate.timeoutMs ?? 120_000}MS`);
      if (code === 0) return finish("PASS");
      const tail = redact(output, options.secrets).trim().split(/\r?\n/).slice(-8).join("\n");
      finish("FAIL", gate.classification ?? "TEST_FAILURE", tail || `EXIT_${code ?? signal ?? "UNKNOWN"}`);
    });
  });
}

export function releaseDecision(profile: "fast" | "full", startedAt: string, durationMs: number, gates: GateResult[]): GuardReport {
  const blocked = gates.some((gate) => gate.blocking && (gate.status === "FAIL" || gate.status === "BLOCKED"));
  return { profile, overall: blocked ? "FAIL" : "PASS", decision: blocked ? "RELEASE_BLOCKED" : "RELEASE_ALLOWED", startedAt, durationMs, gates };
}

export async function writeReport(path: string, report: GuardReport) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
