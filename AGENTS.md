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

- App lives under frontend/; live target in live/targetRegistry.ts, ICP agent in live/icpAgent.ts. Canister IDs from IGNITE_LIVE_ICP_CANISTER_IDS_JSON; no fixtures/credentials in bundle. createLiveAgent caches one HttpAgent per target+principal (clearLiveAgentCache on sign-out) — handshake else paid per actor.
- Preview runs frontend/ via lovable.toml + scripts/*-preview.mjs, mapping SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY onto IGNITE_LIVE_SUPABASE_URL/ANON_KEY; no root package.json.

- Runtime canister config: admins edit IDs at /admin/placement-settings (/admin/icp-canisters redirects); stored in app_settings icp_canister_config, loaded via loadIcpAdminOverrides.ts, merged in getActiveIcpTarget() — canisters deploy after build, so IDs must be runtime-configurable.
- icpAdminOverrides.ts must not import the Supabase client (targetRegistry->overrides->supabase->liveClient cycle); Supabase access in loadIcpAdminOverrides.ts.
- Backend routing (default backend, country eligibility, targets/pins) in live/backendRouting.ts (pure, same cycle rule); stored in app_settings backend_routing_config, loaded via loadBackendRouting.ts, country via userCountry.ts.
- Media bytes: live/mediaStorage.ts (pure) resolves blob_ref -> ICP URL else Supabase path; uploads via live/mediaUpload.ts only with blob-store ID + II session; failures throw.
- /auth screen (Supabase vs Internet Identity) from live/authBackendMode.ts (routing config + country + canister availability); App.tsx gates first paint on placement load before picking auth provider. Never reuse resolveLocalAuthMode here — lab call sites stay false in the live build. Feature routing: withFeatureBackend (live/featureRouter.ts), pure map live/featureBackend.ts; ICP only when its canister ID is set; provisional id mappings until verified on deployed canisters. SIMULATED_TARGET (dry-run) must never reach the routing store or real traffic. Also routed: duty completion, vault rename/move/delete, notification fan_out, announcement broadcast; push + open duties stay Supabase.
- pii_access_control keeps pure crypto in src/crypto.mo (SHA-256 CTR + encrypt-then-MAC); all actor-level state has no initializers and is seeded by the migration chain in src/backend/migrations/ (bootstrap 20260913_000000) — required by --enhanced-migration.
- PII records are keyed pii_id = entity id, field_id = logical field (e.g. "name"); readers list grants decrypt access, enforced canister-side in can_read — never trust browser-supplied reader grants without a verified relationship.
