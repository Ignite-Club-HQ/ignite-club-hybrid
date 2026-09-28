import { supabase } from "@/integrations/supabase/client";
import {
  BACKEND_ROUTING_CONFIG_KEY,
  applyBackendRoutingConfig,
  getBackendRoutingConfig,
  parseBackendRoutingConfig,
  resolveBackendForCountry,
  type BackendProvider,
} from "./backendRouting";
import { getActiveIcpTarget } from "./targetRegistry";
import { getCurrentCountry } from "./userCountry";

/**
 * Loads the app-admin backend routing configuration from
 * `public.app_settings` and applies it to the runtime store. Failures are
 * non-fatal: the app falls back to the default (Supabase everywhere).
 *
 * Kept separate from `backendRouting.ts` because that module must stay free
 * of Supabase imports (see icpAdminOverrides.ts for the module-cycle rule).
 */
export async function loadBackendRoutingConfig(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", BACKEND_ROUTING_CONFIG_KEY)
      .maybeSingle();
    if (error) throw error;
    applyBackendRoutingConfig(data ? parseBackendRoutingConfig(data.value) : null);
  } catch (error) {
    console.warn(
      "[backend-routing] Could not load routing config; defaulting to Supabase.",
      error,
    );
  }
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
