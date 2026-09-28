import type { Identity } from "@icp-sdk/core/agent";
import type { FeatureArea } from "./featureBackend";
import { getCurrentInternetIdentity } from "./internetIdentityAuth";
import { getEffectiveBackendForFeature } from "./loadBackendRouting";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";

/**
 * Runtime dispatcher that connects feature repositories to the hybrid
 * backend architecture. Each feature area calls `withFeatureBackend` with
 * two providers; the dispatcher picks one using the placement-settings
 * routing config, the user's country, and whether the feature's canister is
 * configured (see featureBackend.ts):
 *
 * - Supabase provider: the feature's existing repository code, unchanged.
 * - ICP provider: calls the domain canister through live/domains.ts with the
 *   signed-in Internet Identity.
 *
 * Until a feature's canister ID is configured the dispatcher always takes the
 * Supabase branch, so nothing changes for anyone before canisters exist.
 */

export interface FeatureBackendContext {
  identity: Identity;
  target: IcpTargetConfig;
}

export interface FeatureBackendProviders<T> {
  supabase: () => T | Promise<T>;
  icp: (context: FeatureBackendContext) => T | Promise<T>;
}

export async function withFeatureBackend<T>(
  feature: FeatureArea,
  providers: FeatureBackendProviders<T>,
): Promise<T> {
  if (getEffectiveBackendForFeature(feature) !== "icp") {
    return providers.supabase();
  }
  const identity = await getCurrentInternetIdentity();
  if (!identity) {
    throw new Error(
      `The "${feature}" feature is routed to the Internet Computer backend, ` +
        "but there is no active Internet Identity session. Sign in again to continue.",
    );
  }
  return providers.icp({ identity, target: getActiveIcpTarget() });
}
