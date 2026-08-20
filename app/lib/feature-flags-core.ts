import { createHash } from "node:crypto";

export const FEATURE_FLAG_KEYS = ["CUSTOMER_SHIPMENT_TIMELINE", "CUSTOMER_TRACKING_LINK"] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlagContext = { subjectId?: string; userId?: string; sellerId?: string; orderId?: string };
export type FeatureDecisionReason = "GLOBAL_KILL_SWITCH" | "FEATURE_KILL_SWITCH" | "EXPLICIT_DISABLED" | "ALLOWLIST" | "ROLLOUT" | "ROLLOUT_EXCLUDED" | "MISSING_CONTEXT" | "DEFAULT_ENABLED" | "DEFAULT_DISABLED" | "CONFIG_INVALID";
export type FeatureDecision = { enabled: boolean; reason: FeatureDecisionReason; source: "DEFAULT" | "ENV" | "SAFE_FALLBACK"; evaluatedAt: string; version: string };
export type FeatureFlagState = { key: FeatureFlagKey; enabled: boolean; rolloutPercentage: number; allowlist: string[]; killSwitch: boolean };
export type FeatureSafetyConfig = { version: string; globalKillSwitch: boolean; flags: Record<FeatureFlagKey, FeatureFlagState>; source: FeatureDecision["source"]; valid: boolean };

const DEFAULTS: Record<FeatureFlagKey, Omit<FeatureFlagState, "key">> = {
  CUSTOMER_SHIPMENT_TIMELINE: { enabled: true, rolloutPercentage: 100, allowlist: [], killSwitch: false },
  CUSTOMER_TRACKING_LINK: { enabled: true, rolloutPercentage: 100, allowlist: [], killSwitch: false },
};
const FORBIDDEN_CRITICAL_PATTERNS = [/PAYMENT/i, /AUTH/i, /IDOR/i, /STOCK_TRUTH/i, /CANCELLATION_ELIGIBILITY/i, /FINANCE_GUARD/i];

function defaults(enabled = true): Record<FeatureFlagKey, FeatureFlagState> {
  return Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, { key, ...DEFAULTS[key], ...(enabled ? {} : { enabled: false, rolloutPercentage: 0 }) }])) as Record<FeatureFlagKey, FeatureFlagState>;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, allowed: string[]) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw new Error(`UNKNOWN_CONFIG_FIELD:${unknown.join(",")}`); }

export function parseFeatureSafetyConfig(raw: string): FeatureSafetyConfig {
  const parsed: unknown = JSON.parse(raw); if (!record(parsed)) throw new Error("CONFIG_OBJECT_REQUIRED"); exactKeys(parsed, ["version", "globalKillSwitch", "flags"]);
  if (typeof parsed.version !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(parsed.version)) throw new Error("CONFIG_VERSION_INVALID");
  if (typeof parsed.globalKillSwitch !== "boolean" || !Array.isArray(parsed.flags)) throw new Error("CONFIG_SHAPE_INVALID");
  const flags = defaults(); const seen = new Set<string>();
  for (const value of parsed.flags) {
    if (!record(value)) throw new Error("FLAG_OBJECT_REQUIRED"); exactKeys(value, ["key", "enabled", "rolloutPercentage", "allowlist", "killSwitch"]);
    const keyValue = value.key;
    if (typeof keyValue !== "string" || !FEATURE_FLAG_KEYS.includes(keyValue as FeatureFlagKey)) {
      if (typeof keyValue === "string" && FORBIDDEN_CRITICAL_PATTERNS.some((pattern) => pattern.test(keyValue))) throw new Error("FORBIDDEN_CRITICAL_FLAG");
      throw new Error("UNKNOWN_FEATURE_FLAG");
    }
    if (seen.has(keyValue)) throw new Error("DUPLICATE_FEATURE_FLAG"); seen.add(keyValue);
    if (typeof value.enabled !== "boolean" || typeof value.killSwitch !== "boolean" || !Number.isInteger(value.rolloutPercentage) || (value.rolloutPercentage as number) < 0 || (value.rolloutPercentage as number) > 100) throw new Error("FLAG_STATE_INVALID");
    if (!Array.isArray(value.allowlist) || value.allowlist.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 191) || new Set(value.allowlist).size !== value.allowlist.length) throw new Error("FLAG_ALLOWLIST_INVALID");
    const key = keyValue as FeatureFlagKey; flags[key] = { key, enabled: value.enabled, rolloutPercentage: value.rolloutPercentage as number, allowlist: value.allowlist as string[], killSwitch: value.killSwitch };
  }
  return { version: parsed.version, globalKillSwitch: parsed.globalKillSwitch, flags, source: "ENV", valid: true };
}

export function loadFeatureSafetyConfig(raw: string | undefined): FeatureSafetyConfig {
  if (!raw?.trim()) return { version: "default-v1", globalKillSwitch: false, flags: defaults(), source: "DEFAULT", valid: true };
  try { return parseFeatureSafetyConfig(raw); } catch { return { version: "invalid-fallback-v1", globalKillSwitch: false, flags: defaults(false), source: "SAFE_FALLBACK", valid: false }; }
}

function stableSubject(context: FeatureFlagContext) { return context.subjectId ?? context.userId ?? context.sellerId ?? context.orderId; }
export function rolloutBucket(key: FeatureFlagKey, subject: string) { return createHash("sha256").update(`balikgo-release-safety:v1:${key}:${subject}`).digest().readUInt32BE(0) % 10_000; }
export function evaluateFeature(config: FeatureSafetyConfig, key: FeatureFlagKey, context: FeatureFlagContext = {}, evaluatedAt = new Date()): FeatureDecision {
  const metadata = { source: config.source, evaluatedAt: evaluatedAt.toISOString(), version: config.version } as const;
  if (!config.valid) return { enabled: false, reason: "CONFIG_INVALID", ...metadata };
  const flag = config.flags[key]; if (!flag) throw new Error("UNKNOWN_FEATURE_FLAG");
  if (config.globalKillSwitch) return { enabled: false, reason: "GLOBAL_KILL_SWITCH", ...metadata };
  if (flag.killSwitch) return { enabled: false, reason: "FEATURE_KILL_SWITCH", ...metadata };
  if (!flag.enabled) return { enabled: false, reason: "EXPLICIT_DISABLED", ...metadata };
  const subject = stableSubject(context); if (subject && flag.allowlist.includes(subject)) return { enabled: true, reason: "ALLOWLIST", ...metadata };
  if (flag.rolloutPercentage === 100) return { enabled: true, reason: flag.allowlist.length ? "ROLLOUT" : "DEFAULT_ENABLED", ...metadata };
  if (flag.rolloutPercentage === 0) return { enabled: false, reason: "ROLLOUT_EXCLUDED", ...metadata };
  if (!subject) return { enabled: false, reason: "MISSING_CONTEXT", ...metadata };
  const enabled = rolloutBucket(key, subject) < flag.rolloutPercentage * 100;
  return { enabled, reason: enabled ? "ROLLOUT" : "ROLLOUT_EXCLUDED", ...metadata };
}

export function getFeatureSafetySnapshot(config: FeatureSafetyConfig, environment = process.env.NODE_ENV ?? "unknown") {
  const safeFlags = FEATURE_FLAG_KEYS.map((key) => ({ key, enabled: config.flags[key].enabled, rolloutPercentage: config.flags[key].rolloutPercentage, killSwitch: config.flags[key].killSwitch }));
  const configHash = createHash("sha256").update(JSON.stringify({ version: config.version, globalKillSwitch: config.globalKillSwitch, flags: safeFlags })).digest("hex");
  return { version: config.version, source: config.source, valid: config.valid, environment, globalKillSwitch: config.globalKillSwitch, activeKillSwitches: safeFlags.filter((flag) => flag.killSwitch).map((flag) => flag.key), flags: safeFlags, configHash, generatedAt: new Date().toISOString() };
}
