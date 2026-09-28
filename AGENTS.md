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

- The migrated application lives under `frontend/`; its guarded live target is configured in `frontend/src/live/targetRegistry.ts`, with the shared live ICP agent in `frontend/src/live/icpAgent.ts`. Canister IDs are read from `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`; do not add local fixtures or production credentials to the browser bundle.
- The Lovable preview/dev server runs the `frontend/` app via root `lovable.toml` (`install` = `npm --prefix frontend ci`, `dev` = `node scripts/dev-preview.mjs`, `build:dev` = `node scripts/build-preview.mjs`); the wrappers map the platform-provided `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` onto `IGNITE_LIVE_SUPABASE_URL`/`IGNITE_LIVE_SUPABASE_ANON_KEY` and serve/build `live-index.html`. Why: the merged repo has no root package.json, so without this the preview has nothing to run.

- Runtime ICP canister config: app admins edit canister IDs at /admin/placement-settings (the old /admin/icp-canisters path redirects there); stored in public.app_settings key `icp_canister_config`, loaded at startup via frontend/src/live/loadIcpAdminOverrides.ts and merged in getActiveIcpTarget(). Why: canisters are not deployed at build time, so IDs must be runtime-configurable without a redeploy.
- frontend/src/live/icpAdminOverrides.ts must not import the Supabase client (targetRegistry -> overrides -> supabase -> liveClient -> targetRegistry cycle); Supabase access lives in loadIcpAdminOverrides.ts and the admin page.
- Backend routing (default backend + per-country eligibility + approved targets/pins) lives in frontend/src/live/backendRouting.ts (pure, no Supabase import, same cycle rule); stored in app_settings `backend_routing_config`, loaded via loadBackendRouting.ts, country via userCountry.ts. resolveTargetForCountry returns undefined with no enabled target — callers fall back to backend default. Why: one routing config, one admin save, no parallel placement system.
