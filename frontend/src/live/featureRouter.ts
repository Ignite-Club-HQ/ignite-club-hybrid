import type { Identity } from "@icp-sdk/core/agent";
import { isFeatureCanisterConfigured, type FeatureArea } from "./featureBackend";
import { getCurrentInternetIdentity, getCurrentInternetIdentityConfirmed } from "./internetIdentityAuth";
import { getEffectiveBackendForFeature, isSignedInWithEmail, tryGetActiveIcpTarget } from "./loadBackendRouting";
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
  if (isSignedInWithEmail()) return providers.supabase();
  if (getEffectiveBackendForFeature(feature) !== "icp") {
    // An Internet Identity user has no Supabase account or data: if routing
    // momentarily resolves to Supabase (club-membership pin not loaded yet,
    // unpinned ICP-created club), sending their read/write to Supabase hits
    // rows that don't exist (e.g. "team does not exist" on event create).
    // Keep them on the canister whenever it is configured for this feature.
    const target = tryGetActiveIcpTarget();
    if (target && isFeatureCanisterConfigured(target, feature)) {
      const iiIdentity = await getCurrentInternetIdentity().catch(() => null);
      if (iiIdentity) return providers.icp({ identity: iiIdentity, target });
    }
    return providers.supabase();
  }
  // Signed in with email (Supabase session, no Internet Identity): an ICP
  // club pin can't be served without an identity, so read their Supabase data
  // instead of failing every request.
  if (hasSupabaseSession() && !(await getCurrentInternetIdentity().catch(() => null))) {
    return providers.supabase();
  }
  // Ride out the brief "no session" gap while the session renews itself.
  const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
  if (!identity) {
    throw new Error(
      `The "${feature}" feature is routed to the Internet Computer backend, ` +
        "but there is no active Internet Identity session. Sign in again to continue.",
    );
  }
  return providers.icp({ identity, target: getActiveIcpTarget() });
}

function hasSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token") && localStorage.getItem(k)) return true;
    }
  } catch { /* ignore */ }
  return false;
}
