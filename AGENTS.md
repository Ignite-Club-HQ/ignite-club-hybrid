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

- Runtime ICP canister config: app admins edit canister IDs at /admin/icp-canisters; stored in public.app_settings key `icp_canister_config`, loaded at startup via frontend/src/live/loadIcpAdminOverrides.ts and merged in getActiveIcpTarget(). Why: canisters are not deployed at build time, so IDs must be runtime-configurable without a redeploy.
- frontend/src/live/icpAdminOverrides.ts must not import the Supabase client (targetRegistry -> overrides -> supabase -> liveClient -> targetRegistry cycle); Supabase access lives in loadIcpAdminOverrides.ts and the admin page.
- Backend routing (Supabase vs ICP default + per-country eligibility) lives in frontend/src/live/backendRouting.ts (pure, no Supabase import, same cycle rule as icpAdminOverrides.ts); stored in app_settings key `backend_routing_config`, loaded at startup via loadBackendRouting.ts, country resolved by userCountry.ts (profile `country` column overrides IP lookup). Why: admins must switch backends per country without a redeploy, before canisters exist.
