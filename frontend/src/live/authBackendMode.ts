import {
  getBackendRoutingConfig,
  readCachedClubBackendHint,
  resolveBackendForCountry,
  resolveClubBackendOverride,
  type BackendProvider,
} from "./backendRouting";
import { getActiveIcpTarget } from "./targetRegistry";
import { getCurrentCountry } from "./userCountry";
import { getUserClubIds } from "./userClubs";

/**
 * Decides which sign-in screen `/auth` shows — Supabase (email/password +
 * Google) or Internet Identity — from the app-admin placement settings
 * (`backend_routing_config` in `public.app_settings`), the visitor's country,
 * and whether any ICP canisters are actually configured.
 *
 * Deliberately separate from `resolveLocalAuthMode` in `./localRuntimeMode`:
 * that alias answers "fixture/lab data branch or not" for ~100+ call sites
 * and must stay `false` in the live build, whereas this answers only the
 * auth-screen question and is allowed to flip with infrastructure settings.
 *
 * Pure with respect to the module graph: imports only Supabase-free live
 * modules (same cycle rule as `icpAdminOverrides.ts` / `backendRouting.ts`).
 */

/** True when at least one ICP canister ID is configured for the active target. */
export function isIcpAuthAvailable(): boolean {
  try {
    return Object.keys(getActiveIcpTarget().canisterIds).length > 0;
  } catch {
    return false;
  }
}

/**
 * Pre-auth fallback when no club hint is cached (fresh browser, cleared
 * storage, new device): if every club pin in the routing config names the
 * same backend, that backend is the best guess for an unknown visitor —
 * otherwise a fresh device would always land on the country default even
 * though every pinned club uses ICP. Mixed or no pins → null (country rules).
 * App admins keep the "sign in with email instead" link on the ICP screen.
 */
function unanimousClubPin(config: ReturnType<typeof getBackendRoutingConfig>): BackendProvider | null {
  const pins = new Set(Object.values(config.clubBackendOverrides ?? {}));
  if (pins.size !== 1) return null;
  const [only] = [...pins];
  return only === "icp" || only === "supabase" ? only : null;
}

/**
 * The backend the current visitor should authenticate against, combining the
 * saved routing config, their country (profile override, else IP, else
 * unknown), and canister availability. Inherits the safety net from
 * `resolveBackendForCountry`: ICP is never returned before canisters exist.
 */
export function resolveAuthBackend(): BackendProvider {
  const config = getBackendRoutingConfig();
  const { country } = getCurrentCountry();
  // A per-club backend pin (whole app per club member) wins over the country
  // rules. Post-auth the pin comes from live membership ids; pre-auth — which
  // is when this function decides the /auth screen — it comes from the hint
  // cached by the last post-auth check.
  const clubIds = getUserClubIds();
  const pin = clubIds.length > 0
    ? resolveClubBackendOverride(config, clubIds)
    : readCachedClubBackendHint() ?? unanimousClubPin(config);
  if (pin === "supabase") return "supabase";
  if (pin === "icp") return isIcpAuthAvailable() ? "icp" : "supabase";
  return resolveBackendForCountry(config, country, isIcpAuthAvailable());
}

/** True when `/auth` should show the Internet Identity passkey screen. */
export function useIcpAuthScreen(): boolean {
  return resolveAuthBackend() === "icp";
}
