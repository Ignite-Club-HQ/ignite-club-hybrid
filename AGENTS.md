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

- App lives under `frontend/`; live target in `frontend/src/live/targetRegistry.ts`, shared ICP agent in `frontend/src/live/icpAgent.ts`. Canister IDs from `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`; no fixtures/credentials in the bundle.
- Preview runs `frontend/` via `lovable.toml` + `scripts/dev-preview.mjs`/`build-preview.mjs`, mapping `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` onto `IGNITE_LIVE_SUPABASE_URL`/`ANON_KEY` (no root package.json).

- Runtime ICP canister config: app admins edit canister IDs at /admin/placement-settings (the old /admin/icp-canisters path redirects there); stored in public.app_settings key `icp_canister_config`, loaded at startup via frontend/src/live/loadIcpAdminOverrides.ts and merged in getActiveIcpTarget(). Why: canisters are not deployed at build time, so IDs must be runtime-configurable without a redeploy.
- frontend/src/live/icpAdminOverrides.ts must not import the Supabase client (targetRegistry -> overrides -> supabase -> liveClient -> targetRegistry cycle); Supabase access lives in loadIcpAdminOverrides.ts and the admin page.
- Backend routing (default backend + per-country eligibility + approved targets/pins) lives in frontend/src/live/backendRouting.ts (pure, no Supabase import, same cycle rule); stored in app_settings `backend_routing_config`, loaded via loadBackendRouting.ts, country via userCountry.ts. Why: one routing config, one admin save.
- /auth screen (Supabase vs Internet Identity) comes from frontend/src/live/authBackendMode.ts (routing config + country + canister availability); App.tsx gates first paint on placement load before picking AuthProvider vs IcpAuthProvider. Never reuse resolveLocalAuthMode here — its lab-branch call sites must stay false in the live build. Feature routing: `withFeatureBackend` (live/featureRouter.ts), pure map live/featureBackend.ts; ICP only when its canister ID is set.
