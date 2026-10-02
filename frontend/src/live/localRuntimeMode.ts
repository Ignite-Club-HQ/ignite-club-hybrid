import { resolveAuthBackend } from "./authBackendMode";

/**
 * Live-track replacement for `@/lab/localRuntimeMode`'s `resolveLocalAuthMode`,
 * aliased in for the live build (see `vite.live.config.ts`).
 *
 * Every call site across the shared page/data-layer code (100+ files) calls
 * `resolveLocalAuthMode(search, true)` and uses the result as "should this
 * page take its ICP branch". Historically this module returned `false` in the
 * live build because the deployed Supabase project was the only live source of
 * truth. The domain canisters and their live adapters now exist, so the flag
 * is promoted to the real runtime decision: it follows the placement-settings
 * backend routing (`resolveAuthBackend` — club pin, then country rules), which
 * never returns "icp" before canister IDs are configured. Until then every
 * call site keeps taking its Supabase branch, exactly as before.
 *
 * Per-feature fallback is preserved inside the ICP branches themselves: they
 * route through `withFeatureBackend`, which falls back to the Supabase
 * provider for any feature whose canister ID is not configured.
 *
 * A public URL parameter (`?backend=icp`) must never enable the ICP branch —
 * the routing config is the only authority, so the `search` argument is
 * deliberately ignored.
 */
export function resolveLocalAuthMode(_search: string, _localLabMode = true): boolean {
  return resolveAuthBackend() === "icp";
}
