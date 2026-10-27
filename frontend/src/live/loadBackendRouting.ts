import { supabase } from "@/integrations/supabase/client";
import { readLiveAppConfig } from "./appConfig";
import {
  BACKEND_ROUTING_CONFIG_KEY,
  applyBackendRoutingConfig,
  cacheBackendRoutingConfig,
  getBackendRoutingConfig,
  getBuildTimeBackendRoutingConfig,
  readCachedBackendRoutingConfig,
  parseBackendRoutingConfig,
  resolveBackendForCountry,
  resolveTargetForCountry,
  resolveIcpEngineForCountry,
  isCloudEngineUsable,
  type ApprovedBackendTarget,
  type BackendProvider,
  type BackendRoutingConfig,
} from "./backendRouting";
import { isFeatureCanisterConfigured, resolveFeatureBackend, type FeatureArea } from "./featureBackend";
import { getActiveIcpTarget, registerIcpEngineResolver, type IcpTargetConfig } from "./targetRegistry";
import { getCurrentCountry } from "./userCountry";
import { isSignedInWithEmail, isIcpProviderMounted } from "./authBackendMode";
import { shouldBootstrapFromIcp } from "./icpBootstrap";

export { isSignedInWithEmail };

/**
 * Loads the app-admin backend routing configuration from
 * `public.app_settings` and applies it to the runtime store. Failures are
 * non-fatal: the app falls back to the default (Supabase everywhere).
 *
 * Kept separate from `backendRouting.ts` because that module must stay free
 * of Supabase imports (see icpAdminOverrides.ts for the module-cycle rule).
 */
/**
 * Loads the routing config with explicit precedence:
 *   stored app_settings row > build-time env > canister app_config >
 *   localStorage cache > default.
 * The build-time and cache fallbacks exist so an ICP-routed deployment still
 * boots on ICP when Supabase is unreachable — previously this silently fell
 * back to Supabase-everywhere and the app could not even learn it should be
 * on ICP.
 */
function savedAtOf(value: unknown): number {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).savedAtMs : undefined;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function decodeOnChain(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * The saved routing config, whichever copy is newer: the Supabase
 * app_settings row (written by Supabase-session admins) or the club_domain
 * app_config copy (written by Internet Identity admins, who have no
 * Supabase session and so cannot write the row). Each save stamps
 * `savedAtMs`; a copy without it counts as oldest.
 */
/** Extra wait for the canister copy once the Supabase row has arrived. */
const ON_CHAIN_WAIT_WITH_ROW_MS = 1500;

export async function fetchStoredBackendRoutingConfig(): Promise<BackendRoutingConfig | null> {
  // Restored II sessions must not depend on a Supabase row at startup.
  // Email users retain the existing dual-provider precedence.
  if (shouldBootstrapFromIcp()) {
    const onChain = decodeOnChain(await readLiveAppConfig(BACKEND_ROUTING_CONFIG_KEY));
    return onChain ? parseBackendRoutingConfig(onChain) : null;
  }
  let row: unknown = null;
  let rowError: unknown = null;
  // Read both copies in parallel (they used to run back to back, adding a
  // full canister round trip to every boot). The on-chain copy is capped so
  // a slow replica never holds the splash once the Supabase row is in.
  const onChainPromise = readLiveAppConfig(BACKEND_ROUTING_CONFIG_KEY);
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", BACKEND_ROUTING_CONFIG_KEY)
      .maybeSingle();
    if (error) throw error;
    row = data?.value ?? null;
  } catch (error) {
    rowError = error;
  }
  const onChainRaw = row
    ? await Promise.race([
        onChainPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ON_CHAIN_WAIT_WITH_ROW_MS)),
      ])
    : await onChainPromise;
  const onChain = decodeOnChain(onChainRaw);
  const pick = onChain && (!row || savedAtOf(onChain) > savedAtOf(row)) ? onChain : row;
  if (!pick && rowError) throw rowError;
  return pick ? parseBackendRoutingConfig(pick) : null;
}

export async function loadBackendRoutingConfig(): Promise<void> {
  try {
    const stored = await fetchStoredBackendRoutingConfig();
    if (stored) {
      applyBackendRoutingConfig(stored);
      cacheBackendRoutingConfig(stored);
      return;
    }
  } catch (error) {
    console.warn(
      "[backend-routing] Could not load routing config; trying build-time configuration.",
      error,
    );
  }
  try {
    const buildTime = getBuildTimeBackendRoutingConfig();
    if (buildTime) {
      applyBackendRoutingConfig(buildTime);
      return;
    }
  } catch (error) {
    console.warn("[backend-routing] Build-time routing config is invalid; ignoring it.", error);
  }
  // Canister-hosted copy of the routing config (club_domain.get_app_config),
  // read anonymously — lets an ICP-only deployment boot without Supabase and
  // without a build-time env or a warm cache.
  try {
    const onChain = decodeOnChain(await readLiveAppConfig(BACKEND_ROUTING_CONFIG_KEY));
    if (onChain) {
      const parsed = parseBackendRoutingConfig(onChain);
      if (parsed) {
        applyBackendRoutingConfig(parsed);
        cacheBackendRoutingConfig(parsed);
        return;
      }
    }
  } catch (error) {
    console.warn("[backend-routing] Could not load routing config from the canister; trying cache.", error);
  }
  const cached = readCachedBackendRoutingConfig();
  if (cached) {
    applyBackendRoutingConfig(cached);
    console.warn("[backend-routing] Using the last cached routing config.");
    return;
  }
  console.warn("[backend-routing] No routing config available; defaulting to Supabase.");
  applyBackendRoutingConfig(null);
}

// Country -> ICP Cloud Engine assignment feeds getActiveIcpTarget().
registerIcpEngineResolver(() => {
  const engine = resolveIcpEngineForCountry(getBackendRoutingConfig(), getCurrentCountry().country);
  if (!engine) return null;
  return {
    alias: engine.alias,
    host: engine.host,
    canisterIds: engine.canisterIds,
    region: engine.region,
    usable: isCloudEngineUsable(engine),
  };
});

function isIcpAvailable(): boolean {
  try {
    return Object.keys(getActiveIcpTarget().canisterIds).length > 0;
  } catch {
    return false;
  }
}


/**
 * The active ICP target, or null when none is configured. Never throws, so
 * routing checks can call it freely.
 */
export function tryGetActiveIcpTarget(): IcpTargetConfig | null {
  try {
    return getActiveIcpTarget();
  } catch {
    return null;
  }
}

/**
 * Which backend should serve the current user right now. One rule, no
 * per-club pin: email sign-in reads Supabase, secure sign-in reads the
 * canisters (when any are configured), and a signed-out visitor follows the
 * routing config for their country.
 */
export function getEffectiveBackend(): BackendProvider {
  if (isSignedInWithEmail()) return "supabase";
  if (hasStoredInternetIdentitySession()) return "icp";
  const config = getBackendRoutingConfig();
  const { country } = getCurrentCountry();
  return resolveBackendForCountry(config, country, isIcpAvailable());
}

/**
 * The approved deployment target that should serve the current user, or
 * undefined when no enabled target exists for the effective backend (callers
 * then use the backend's built-in default).
 */
export function getEffectiveTarget(): ApprovedBackendTarget | undefined {
  const config = getBackendRoutingConfig();
  const { country } = getCurrentCountry();
  return resolveTargetForCountry(config, country, isIcpAvailable());
}

/**
 * Which backend should serve one feature area right now: the same rule as
 * getEffectiveBackend(), narrowed per feature — a secure sign-in session only
 * gets "icp" when that feature's canister is actually configured, so a
 * feature whose canister is not deployed yet keeps using Supabase instead of
 * failing every request.
 */
export function getEffectiveBackendForFeature(feature: FeatureArea): BackendProvider {
  // Signed in with email: every feature reads Supabase. Without this,
  // isFeatureRoutedToIcp() returned true for email users and Messages/Media
  // went to the canisters (blank).
  if (isSignedInWithEmail()) return "supabase";
  if (isIcpProviderMounted() || hasStoredInternetIdentitySession()) {
    return "icp";
  }
  const config = getBackendRoutingConfig();
  const { country } = getCurrentCountry();
  return resolveFeatureBackend(config, country, tryGetActiveIcpTarget(), feature);
}

/**
 * True when a feature is currently served by an ICP canister. Realtime
 * surfaces use this to skip Supabase Realtime subscriptions and poll via
 * query calls instead — canisters are request/response and have no push
 * channel.
 */
export function isFeatureRoutedToIcp(feature: FeatureArea): boolean {
  if (getEffectiveBackendForFeature(feature) === "icp") return true;
  if (isSignedInWithEmail()) return false;
  // Mirror withFeatureBackend's fallback: an Internet Identity user has no
  // Supabase data, so when routing momentarily resolves to Supabase (e.g. a
  // just-created, unpinned club tips the club-pin check) keep pages on the
  // canister instead of querying Supabase and showing "not found".
  if (!hasStoredInternetIdentitySession()) return false;
  const target = tryGetActiveIcpTarget();
  return !!target && isFeatureCanisterConfigured(target, feature);
}

export function hasStoredInternetIdentitySession(): boolean {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ignite_icp_internet_identity_session") : null;
    const parsed = raw ? (JSON.parse(raw) as { principal?: unknown }) : null;
    return typeof parsed?.principal === "string" && parsed.principal.length > 0;
  } catch {
    return false;
  }
}

