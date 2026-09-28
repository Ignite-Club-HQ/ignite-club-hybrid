import {
  getBackendRoutingConfig,
  resolveBackendForCountry,
  type BackendProvider,
} from "./backendRouting";
import { getActiveIcpTarget } from "./targetRegistry";
import { getCurrentCountry } from "./userCountry";

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
 * The backend the current visitor should authenticate against, combining the
 * saved routing config, their country (profile override, else IP, else
 * unknown), and canister availability. Inherits the safety net from
 * `resolveBackendForCountry`: ICP is never returned before canisters exist.
 */
export function resolveAuthBackend(): BackendProvider {
  const { country } = getCurrentCountry();
  return resolveBackendForCountry(getBackendRoutingConfig(), country, isIcpAuthAvailable());
}

/** True when `/auth` should show the Internet Identity passkey screen. */
export function useIcpAuthScreen(): boolean {
  return resolveAuthBackend() === "icp";
}
