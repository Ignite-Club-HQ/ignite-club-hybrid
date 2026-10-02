/**
 * Live-track replacement for `@/lab/localRuntimeMode`'s `resolveLocalAuthMode`,
 * aliased in only for the live build (see `vite.live.config.ts`).
 *
 * Every call site across the shared page/data-layer code (100+ files) calls
 * `resolveLocalAuthMode(search, true)`, hardcoding the "isolated lab" branch
 * literally at each call site — see the lab's own version of this function
 * for its doc comment: "the lab passes `true` while a promoted application
 * must pass its deployment configuration instead of inheriting local mode
 * or fixture behavior." Because every call site already passes a literal
 * `true`, only aliasing this whole module (the same alias-substitution
 * pattern already used for the Supabase client and Internet Identity auth
 * module) can change that decision for the live build without editing
 * every call site.
 *
 * The branches this flag guards are LAB-FIXTURE simulations: they call
 * `getLocalLab*`/`listLocal*`/`connectLocal*` functions from `@/lab/*`
 * modules, which the live build aliases to throwing stubs
 * (`src/live/disabledLabRuntime.ts`). Returning `true` here would crash
 * real Internet Identity users, not route them to canisters. Real ICP
 * routing for signed-in II users happens inside the non-lab branches via
 * `resolveAuthBackend()` / `withFeatureBackend` — never through this flag.
 *
 * The deployed Supabase project remains the live source of truth until each
 * domain has a provider-neutral live ICP adapter and deployed canister ID.
 * The former `?backend=icp` override selected fixture/local-actor branches,
 * not the remote canisters, so a public URL parameter must never enable it.
 */
export function resolveLocalAuthMode(_search: string, _localLabMode = true): boolean {
  return false;
}
