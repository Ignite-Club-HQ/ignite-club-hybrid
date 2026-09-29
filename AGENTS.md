<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- App lives under `frontend/`; live target in `frontend/src/live/targetRegistry.ts`, ICP agent in `frontend/src/live/icpAgent.ts`. Canister IDs from `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`; no fixtures/credentials in the bundle. `createLiveAgent` caches one HttpAgent per target+principal, cleared on sign-out via `clearLiveAgentCache` — the create handshake would otherwise be paid per domain actor.
- Preview runs `frontend/` via `lovable.toml` + scripts/dev-preview.mjs/build-preview.mjs, mapping SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY onto IGNITE_LIVE_SUPABASE_URL/ANON_KEY (no root package.json).

- Runtime ICP canister config: admins edit canister IDs at /admin/placement-settings (/admin/icp-canisters redirects); stored in app_settings `icp_canister_config`, loaded via loadIcpAdminOverrides.ts, merged in getActiveIcpTarget(). Why: canisters aren't deployed at build time, so IDs must be runtime-configurable.
- icpAdminOverrides.ts must not import the Supabase client (targetRegistry -> overrides -> supabase -> liveClient cycle); Supabase access lives in loadIcpAdminOverrides.ts.
- Backend routing (default backend, country eligibility, approved targets/pins) lives in frontend/src/live/backendRouting.ts (pure, no Supabase import, same cycle rule); stored in app_settings `backend_routing_config`, loaded via loadBackendRouting.ts, country via userCountry.ts. Why: one routing config, one admin save.
- /auth screen (Supabase vs Internet Identity) comes from frontend/src/live/authBackendMode.ts (routing config + country + canister availability); App.tsx gates first paint on placement load before picking AuthProvider vs IcpAuthProvider. Never reuse resolveLocalAuthMode here — its lab call sites must stay false in the live build. Feature routing: `withFeatureBackend` (live/featureRouter.ts), pure map live/featureBackend.ts; ICP only when its canister ID is set. The placement-settings dry-run card uses a synthetic target (SIMULATED_TARGET) — never write it to the routing store or use it for real traffic.
