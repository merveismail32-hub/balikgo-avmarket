import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment.ts";

const root = resolve(import.meta.dirname, "..");
const runtimeEnv = hydrateVerifiedTestEnvironment(process.env, root);
const port = await new Promise<number>((resolvePort, reject) => { const socket = createServer(); socket.once("error", reject); socket.listen(0, "127.0.0.1", () => { const address = socket.address(); socket.close(error => error ? reject(error) : resolvePort(typeof address === "object" && address ? address.port : 0)); }); });
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(port), "-H", "127.0.0.1"], { cwd: root, env: runtimeEnv, shell: false, windowsHide: true, stdio: "ignore" });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error("CAMPAIGN_CHECKOUT_SERVER_EXITED");
    try { if ((await fetch(`${baseUrl}/api/auth/csrf`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  if (!ready) throw new Error("CAMPAIGN_CHECKOUT_SERVER_READINESS_TIMEOUT");
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", pathToFileURL(resolve(root, "scripts/test-os-userinfo-preload.mjs")).href, "--import", "tsx", resolve(root, "scripts/test-campaign-checkout-db-e2e.ts")], { cwd: root, env: { ...runtimeEnv, QA_BASE_URL: baseUrl }, shell: false, windowsHide: true, stdio: "inherit", timeout: 600_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`CAMPAIGN_CHECKOUT_TEST_EXIT_${result.status ?? "UNKNOWN"}`);
} finally {
  if (server.exitCode === null) server.kill();
}
