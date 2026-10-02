import { supabase } from "@/integrations/supabase/client";
import {
  BACKEND_ROUTING_CONFIG_KEY,
  applyBackendRoutingConfig,
  cacheBackendRoutingConfig,
  getBackendRoutingConfig,
  getBuildTimeBackendRoutingConfig,
  readCachedBackendRoutingConfig,
  parseBackendRoutingConfig,
  readCachedClubBackendHint,
  resolveBackendForCountry,
  resolveClubBackendOverride,
  resolveTargetForCountry,
  type ApprovedBackendTarget,
  type BackendProvider,
  type BackendRoutingConfig,
} from "./backendRouting";
import { isFeatureCanisterConfigured, resolveFeatureBackend, type FeatureArea } from "./featureBackend";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
import { getCurrentCountry } from "./userCountry";
import { getUserClubIds } from "./userClubs";

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
/**
 * The per-club backend pin for the current user, or null. Post-auth this
 * uses the live membership ids loaded by ClubBackendEnforcement; pre-auth
 * (the /auth screen decision) it falls back to the hint cached by the last
 * post-auth check.
 */
function currentClubBackendOverride(config: BackendRoutingConfig): BackendProvider | null {
  const clubIds = getUserClubIds();
  if (clubIds.length > 0) return resolveClubBackendOverride(config, clubIds);
  return readCachedClubBackendHint();
}

export function getEffectiveBackend(): BackendProvider {
  const config = getBackendRoutingConfig();
  const { country } = getCurrentCountry();
  const pin = currentClubBackendOverride(config);
  if (pin === "supabase") return "supabase";
  if (pin === "icp") return isIcpAvailable() ? "icp" : "supabase";
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
  const pin = currentClubBackendOverride(config);
  if (!pin) return resolveTargetForCountry(config, country, isIcpAvailable());
  // A club pin flips the backend; pick an approved target for that backend.
  const backend: BackendProvider = pin === "icp" && !isIcpAvailable() ? "supabase" : pin;
  const enabledForBackend = config.targets.filter(t => t.enabled && t.backend === backend);
  const code = country?.trim().toUpperCase();
  const pinnedId = code ? config.countryTargets[code] : undefined;
  if (pinnedId) {
    const pinned = enabledForBackend.find(t => t.id === pinnedId);
    if (pinned) return pinned;
  }
  return enabledForBackend[0];
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
  const config = getBackendRoutingConfig();
  const { country } = getCurrentCountry();
  const pin = currentClubBackendOverride(config);
  if (pin === "supabase") return "supabase";
  if (pin === "icp") {
    const target = tryGetActiveIcpTarget();
    return target && isFeatureCanisterConfigured(target, feature) ? "icp" : "supabase";
  }
  return resolveFeatureBackend(config, country, tryGetActiveIcpTarget(), feature);
}

/**
 * True when a feature is currently served by an ICP canister. Realtime
 * surfaces use this to skip Supabase Realtime subscriptions and poll via
 * query calls instead — canisters are request/response and have no push
 * channel.
 */
export function isFeatureRoutedToIcp(feature: FeatureArea): boolean {
  return getEffectiveBackendForFeature(feature) === "icp";
}
