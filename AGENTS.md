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

- App lives under frontend/; live target in live/targetRegistry.ts, ICP agent in live/icpAgent.ts. Canister IDs from IGNITE_LIVE_ICP_CANISTER_IDS_JSON; no fixtures/credentials in the bundle. createLiveAgent caches one HttpAgent per target+principal (clearLiveAgentCache on sign-out) — handshake else paid per actor.
- Preview runs frontend/ via lovable.toml + scripts/dev-preview.mjs/build-preview.mjs, mapping SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY onto IGNITE_LIVE_SUPABASE_URL/ANON_KEY; no root package.json.

- Runtime canister config: admins edit IDs at /admin/placement-settings (/admin/icp-canisters redirects); stored in app_settings icp_canister_config, loaded via loadIcpAdminOverrides.ts, merged in getActiveIcpTarget() — canisters deploy after build, so IDs must be runtime-configurable.
- icpAdminOverrides.ts must not import the Supabase client (targetRegistry->overrides->supabase->liveClient cycle); Supabase access lives in loadIcpAdminOverrides.ts.
- Backend routing (default backend, country eligibility, targets/pins) lives in live/backendRouting.ts (pure, same cycle rule); stored in app_settings backend_routing_config, loaded via loadBackendRouting.ts, country via userCountry.ts — one routing config, one admin save.
- Media bytes resolve via live/mediaStorage.ts (pure, same cycle rule): asset blob_ref (key media_blob_store) -> ICP URL, else Supabase storage_path — keeps storage backend out of feature code.
- /auth screen (Supabase vs Internet Identity) comes from live/authBackendMode.ts (routing config + country + canister availability); App.tsx gates first paint on placement load before picking AuthProvider vs IcpAuthProvider. Never reuse resolveLocalAuthMode here — lab call sites must stay false in the live build. Feature routing: withFeatureBackend (live/featureRouter.ts), pure map live/featureBackend.ts; ICP only when its canister ID is set. The dry-run card's synthetic target (SIMULATED_TARGET) must never reach the routing store or real traffic.
