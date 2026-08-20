import "server-only";

import { evaluateFeature, getFeatureSafetySnapshot, loadFeatureSafetyConfig, type FeatureFlagContext, type FeatureFlagKey } from "./feature-flags-core";

export function featureSafetyConfig() { return loadFeatureSafetyConfig(process.env.BALIKGO_RELEASE_SAFETY_CONFIG); }
export function featureDecision(key: FeatureFlagKey, context?: FeatureFlagContext) { return evaluateFeature(featureSafetyConfig(), key, context); }
export function currentFeatureSafetySnapshot() { return getFeatureSafetySnapshot(featureSafetyConfig()); }
