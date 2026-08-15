import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

type Spawn = typeof spawnSync;

export function repositoryRoot() {
  const root = realpathSync(resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1")), ".."));
  if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "prisma.config.ts"))) throw new Error("REPOSITORY_ROOT_INVALID");
  return root;
}

function inside(parent: string, child: string) {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

export function resolveLocalPrismaCli(root: string) {
  const repo = realpathSync(root);
  const require = createRequire(join(repo, "package.json"));
  let packageJsonPath: string;
  try { packageJsonPath = realpathSync(require.resolve("prisma/package.json")); } catch { throw new Error("LOCAL_PRISMA_PACKAGE_NOT_FOUND"); }
  const packageRoot = realpathSync(dirname(packageJsonPath));
  const dependencyRoot = realpathSync(join(repo, "node_modules", "prisma"));
  if (packageRoot !== dependencyRoot || !inside(repo, packageRoot)) throw new Error("LOCAL_PRISMA_PACKAGE_OUTSIDE_REPOSITORY");
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string; version?: string; bin?: { prisma?: string } };
  if (manifest.name !== "prisma" || manifest.bin?.prisma !== "build/index.js" || !manifest.version) throw new Error("LOCAL_PRISMA_MANIFEST_INVALID");
  const entrypoint = realpathSync(join(packageRoot, manifest.bin.prisma));
  validatePrismaEntrypoint(repo, packageRoot, entrypoint);
  const lock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8")) as { packages?: Record<string, { version?: string }> };
  if (lock.packages?.["node_modules/prisma"]?.version !== manifest.version) throw new Error("LOCAL_PRISMA_LOCK_VERSION_MISMATCH");
  return { entrypoint, packageRoot, version: manifest.version };
}

export function validatePrismaEntrypoint(repo: string, packageRoot: string, entrypoint: string) {
  const expectedRoot = realpathSync(join(realpathSync(repo), "node_modules", "prisma"));
  if (realpathSync(packageRoot) !== expectedRoot || !inside(expectedRoot, realpathSync(entrypoint)) || realpathSync(entrypoint) !== realpathSync(join(expectedRoot, "build", "index.js")) || !lstatSync(entrypoint).isFile()) throw new Error("LOCAL_PRISMA_ENTRYPOINT_INVALID");
}

export function sanitizeChildText(value: string, secrets: Array<string | undefined>) {
  let safe = value;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join("[REDACTED]");
  return safe.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]");
}

export function runLocalPrisma(input: { root: string; action: string; env: NodeJS.ProcessEnv; spawn?: Spawn }) {
  if (input.action !== "status" && input.action !== "deploy") throw new Error("MIGRATION_ACTION_REQUIRED");
  const root = realpathSync(input.root);
  const cli = resolveLocalPrismaCli(root);
  const run = input.spawn ?? spawnSync;
  const result = run(process.execPath, [cli.entrypoint, "migrate", input.action], { cwd: root, env: input.env, shell: false, encoding: "utf8" }) as SpawnSyncReturns<string>;
  const secrets = [input.env.DATABASE_URL, input.env.DIRECT_URL];
  const stdout = sanitizeChildText(result.stdout ?? "", secrets); const stderr = sanitizeChildText(result.stderr ?? "", secrets);
  if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr);
  if (result.error) throw new Error(`PRISMA_CHILD_SPAWN_FAILED:${result.error.name}`);
  if (result.signal) throw new Error(`PRISMA_CHILD_SIGNAL:${result.signal}`);
  if (result.status !== 0) throw new Error(`PRISMA_CHILD_EXIT_${result.status ?? "UNKNOWN"}`);
  return { version: cli.version };
}
