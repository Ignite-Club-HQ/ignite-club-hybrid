import { supabase } from "@/integrations/supabase/client";
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
  type ApprovedBackendTarget,
  type BackendProvider,
} from "./backendRouting";
import { resolveFeatureBackend, type FeatureArea } from "./featureBackend";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
import { getCurrentCountry } from "./userCountry";

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
 *   stored app_settings row > build-time env > localStorage cache > default.
 * The build-time and cache fallbacks exist so an ICP-routed deployment still
 * boots on ICP when Supabase is unreachable — previously this silently fell
 * back to Supabase-everywhere and the app could not even learn it should be
 * on ICP.
 */
export async function loadBackendRoutingConfig(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", BACKEND_ROUTING_CONFIG_KEY)
      .maybeSingle();
    if (error) throw error;
    const stored = data ? parseBackendRoutingConfig(data.value) : null;
    if (stored) {
      applyBackendRoutingConfig(stored);
      cacheBackendRoutingConfig(stored);
      return;
    }
  } catch (error) {
    console.warn(
      "[backend-routing] Could not load routing config from Supabase; trying build-time configuration.",
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
  const cached = readCachedBackendRoutingConfig();
  if (cached) {
    applyBackendRoutingConfig(cached);
    console.warn("[backend-routing] Using the last cached routing config.");
    return;
  }
  console.warn("[backend-routing] No routing config available; defaulting to Supabase.");
  applyBackendRoutingConfig(null);
}

function isIcpAvailable(): boolean {
  try {
    return Object.keys(getActiveIcpTarget().canisterIds).length > 0;
  } catch {
    return false;
  }
}

/**
 * Which backend should serve the current user right now, combining the saved
 * routing config, the user's country (profile override, else IP), and whether
 * any ICP canisters are actually configured. Feature routing only — this
 * never blocks access.
 */
export function getEffectiveBackend(): BackendProvider {
  const { country } = getCurrentCountry();
  return resolveBackendForCountry(getBackendRoutingConfig(), country, isIcpAvailable());
}

/**
 * The approved deployment target that should serve the current user, or
 * undefined when no enabled target exists for the effective backend (callers
 * then use the backend's built-in default).
 */
export function getEffectiveTarget(): ApprovedBackendTarget | undefined {
  const { country } = getCurrentCountry();
  return resolveTargetForCountry(getBackendRoutingConfig(), country, isIcpAvailable());
}

function tryGetActiveIcpTarget(): IcpTargetConfig | null {
  try {
    return getActiveIcpTarget();
  } catch {
    return null;
  }
}

/**
 * Which backend should serve one feature area right now. Per-feature variant
 * of getEffectiveBackend(): ICP is only returned when the routing config
 * resolves ICP for the user's country AND that feature's canister ID is
 * configured on the active ICP target — so a feature whose canister is not
 * deployed yet transparently keeps using Supabase.
 */
export function getEffectiveBackendForFeature(feature: FeatureArea): BackendProvider {
  const { country } = getCurrentCountry();
  return resolveFeatureBackend(getBackendRoutingConfig(), country, tryGetActiveIcpTarget(), feature);
}
