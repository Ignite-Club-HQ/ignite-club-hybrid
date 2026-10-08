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
const AUTH_CHOICE_KEY = "ignite.authChoice";

/**
 * Device-level sign-in choice from `?auth=email` / `?auth=icp` (persisted so
 * the whole app — not just /auth — stays on that system after the redirect).
 * Lets the on-chain copy run in Supabase mode even when routing would pick ICP,
 * and vice versa. `?auth=auto` clears the choice and follows routing again.
 */
export function readAuthChoice(): BackendProvider | null {
  try {
    const param = new URLSearchParams(window.location.search).get("auth");
    if (param === "email" || param === "supabase") localStorage.setItem(AUTH_CHOICE_KEY, "supabase");
    else if (param === "icp") localStorage.setItem(AUTH_CHOICE_KEY, "icp");
    // `?auth=auto` forgets the device choice so the club pin / default decides
    // again — the only other wipe is the club-backend enforcement switch.
    else if (param === "auto" || param === "default") localStorage.removeItem(AUTH_CHOICE_KEY);
    const v = localStorage.getItem(AUTH_CHOICE_KEY);
    return v === "supabase" || v === "icp" ? v : null;
  } catch {
    return null;
  }
}

function hasSupabaseSessionStored(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token") && localStorage.getItem(k)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

export function hasInternetIdentitySessionStored(): boolean {
  try {
    const raw = localStorage.getItem("ignite_icp_internet_identity_session");
    const parsed = raw ? (JSON.parse(raw) as { principal?: unknown }) : null;
    return typeof parsed?.principal === "string" && parsed.principal.length > 0;
  } catch {
    return false;
  }
}

/**
 * True when the person is currently signed in with email (Supabase): a
 * Supabase session is stored and either this device chose email
 * (?auth=email) or there is no Internet Identity session. The actual
 * signed-in system always decides where their data is read from — a club
 * pin to ICP can't serve someone without an Internet Identity.
 */
let mountedAuthProvider: BackendProvider | null = null;

/**
 * Called by the mounted auth provider (Supabase AuthProvider or
 * IcpAuthProvider). The mounted provider is the truth about how the person
 * signed in — a leftover Internet Identity record on the device from an
 * earlier sign-in must not pull an email user's pages onto the canisters.
 */
export function markMountedAuthProvider(provider: BackendProvider): void {
  mountedAuthProvider = provider;
}

export function isSignedInWithEmail(): boolean {
  if (mountedAuthProvider === "icp") return false;
  if (!hasSupabaseSessionStored()) return false;
  if (mountedAuthProvider === "supabase") return true;
  if (readAuthChoice() === "supabase") return true;
  return !hasInternetIdentitySessionStored();
}

export function resolveAuthBackend(): BackendProvider {
  if (isSignedInWithEmail()) return "supabase";
  const choice = readAuthChoice();
  if (choice === "supabase") return "supabase";
  if (choice === "icp" && isIcpAuthAvailable()) return "icp";
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
