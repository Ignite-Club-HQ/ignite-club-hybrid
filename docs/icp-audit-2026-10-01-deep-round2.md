# ICP Deep Audit — Round 2 (2026-10-01)

Method: five parallel audit agents (frontend Supabase dependencies, live/ integration layer, Motoko canisters, Rust canisters + cross-canister architecture, Internet Identity integration), each judging against the official IC skill guides fetched from skills.internetcomputer.org (canister-security, writing-motoko, migrating-motoko-actors, https-outcalls, multi-canister, stable-memory, cycles-management, internet-identity). **Every headline finding was then verified by reading the actual source.** Raw agent output contained many false positives (gates hidden in parent components / module aliasing); only verified findings are listed below.

## Build & interface verification (all green)

- 13 Motoko canisters compile with `moc 1.16.1 --enhanced-migration`; `secret_workload_identity` compiles without the flag (direct persistent actor, no migration chain — by design).
- 4 Rust canisters (`identity_access`, `placement_registry`, `shard_router`, `timer_jobs`) pass `cargo check --target wasm32-unknown-unknown`.
- Candid drift check: 17/17 green.
- Migration-chain rules (self-contained timestamped files, OldActor = previous NewActor, backfilled fields): followed in all chains checked.

## Canister findings (verified in source)

### CRITICAL
1. **`identity_access/src/lib.rs:1157`** — HMAC attestation compared with `expected != signature_hex.to_lowercase()` (non-constant-time). A timing side channel against the IAP attestation secret. Fix: constant-time comparison over the decoded bytes. **FIXED 2026-10-01**: raw HMAC bytes now compared via `constant_time_eq` against hex-decoded input (`hex_decode`/`constant_time_eq` helpers at ~lib.rs:992); `hex_encode` removed (was only used by this site). `cargo check --target wasm32-unknown-unknown` clean, 14/14 unit tests pass.

### HIGH
2. **`identity_access/src/lib.rs:156,169-174`** — entire state (accounts, profiles, roles, entitlements) stored in ONE `StableCell<Vec<u8>>`, fully decoded/re-encoded on **every** update call, with caps of 100,000 roles/entitlements (`MAX_ROLES`/`MAX_ENTITLEMENTS` lines 18/23). Will hit the instruction limit far below the caps → bricked canister. Fix: `StableBTreeMap` per collection. Related: `upsert_entitlement` (line ~1030) is an O(N) linear scan per call.
3. ~~**All 14 Motoko canisters — `initialize()` first-caller-wins.**~~ **FIXED 2026-10-01**: confirmed all 13 Motoko canisters with an `initialize()` already reject re-initialization (no code change needed there) — mitigation (b) from this finding (call `initialize()` immediately after deploy, before any other traffic) is now encoded as a hard rule in `backend/AGENTS.md`. Additionally, all 13 canisters (club_domain, club_points_domain, competition_domain, events_domain, insights_domain, media_metadata, messaging_domain, mini_league_domain, vault_domain, secret_workload_identity, pii_access_control, migration_coordinator, notification_queue) gained a governor-only `transfer_governorship(new_governor : Principal)` so a misassigned governor from a deploy-script mistake can still be corrected without a canister upgrade. All 13 compile with moc 1.16.1, `.did` files regenerated, frontend bindings regenerated in both `frontend/src/lab/bindings/<c>` and `frontend/src/lab/generated-contracts/<c>`, candid drift check 17/17 green.
4. ~~**`pii_access_control/src/main.mo:~279-324` (`register_pii`)** — TOCTOU~~ **FALSE POSITIVE (re-verified 2026-10-01)**: the only await is `random_bytes` (line 303); `derive_field_key`/`aead_encrypt` are synchronous (`Crypto.*` pure functions, main.mo:225-231), and the filter+concat on `pii_records` (lines 322-324) executes in the same atomic message block AFTER the await. Motoko delivers no interleaving between the filter read and the append write, so concurrent registrations cannot duplicate a `pii_id`+`field_id` record — the second registration's filter removes the first's record (last-writer-wins upsert, which is the intended semantics per the "Remove existing if any, then append" comment). No code change required.
5. **Systemic: unbounded arrays with O(N) concat across Motoko canisters.** Verified: `messaging_domain/src/main.mo:21` `var messages : [Types.Message]` with `messages := messages.concat([msg])` (line 241); same pattern for primary state in club_domain (profiles line 167), events_domain, competition_domain, mini_league_domain, club_points_domain, insights_domain, notification_queue. Heap exhaustion / instruction-limit DoS as data grows; no caps. Also `generate_chat_recap` (messaging_domain:1208) scans ALL messages to filter one conversation. Fix (large): migrate hot collections to `Map`/`Buffer` with hard caps. This is an architecture-level piece of work, not a patch.

### MEDIUM
6. `migration_coordinator` — `orchestrateExport` awaits source/destination canisters sequentially (lines ~264-265); parallelize to cut orchestration time.
7. `timer_jobs` — reachable `unwrap()`/`expect()` in job encode/decode paths; traps if stable memory is corrupted.
8. No canister exposes a cycle-balance query/monitoring hook; with 17 canisters, add a `cycles_balance()` query (or use `canister_status` from the placement_registry controller) and set freezing thresholds. (cycles-management skill.)

### PASSED (checked, no issue)
- `generate_chat_recap` HTTPS outcall: `is_replicated = ?false`, `Idempotency-Key`, `max_response_bytes = 32_000`, catch-all error handling — compliant with the https-outcalls skill.
- `placement_registry`, `shard_router`: correct `StableBTreeMap` usage, governor/operator access control, revision-checked migration state machine.
- `pii_access_control`: pure crypto correctly isolated in `src/crypto.mo`; state without initializers per backend/AGENTS.md.
- All update calls reject the anonymous principal (spot-checked across canisters).
- `identity_access` has a self-check against its `.did` file — good drift prevention.

## Frontend findings (verified — each confirmed reachable by an II user in ICP mode)

| # | File:line | Break in ICP mode |
|---|-----------|-------------------|
| F1 | `components/NextUpCarousel.tsx:191-218` | `useChildRsvps` queries `children`/`child_guardians` by `userId` ungated → uuid-type error thrown for principal-text IDs; household RSVP cards error. |
| F2 | `components/AccountRecoveryBanner.tsx:23` | Ungated `profiles` status query on every Home load (only the mutation is gated). |
| F3 | `components/AddClubAdminSheet.tsx:73,87,102` | `existingMembers`, `clubBranding`, `search_invitable_profiles` RPC ungated — admin management lookups hit Supabase. |
| F4 | `components/AddressAutocomplete.tsx:119,156,280` | `google-places-search` Edge Function invoke ungated — II users have no Supabase JWT. |
| F5 | `components/AssociationEventsPanel.tsx:163` | `association-create-club-event` invoke reachable (AssociationDetailPage defaults to Supabase view) — II association admins can't create events. |
| F6 | `components/MemberSubscriptionPaymentsManager.tsx:219,273,290` | Manual "Mark Paid" and "Send Reminders" ungated (online payments are gated at line 337). Non-IAP payments are Supabase-only by design → these paths must be gated/blocked. |
| F7 | `components/PlayHQTeamLinkCard.tsx:114,126` | `teams.update` + `playhq-materialise-team-events` invoke ungated. |
| F8 | `components/PlayerOfMatchSelector.tsx:282,352,365,379` | Notification inserts + child lookups run outside the points `withFeatureBackend` gate — awarding fails part-way for II users. |
| F9 | `components/SponsorOrAdCarousel.tsx:66,69,185,190,201` | `auth.getUser`/`user_roles`/`sponsors` lookups ungated → failing queries + console noise. |
| F10 | `components/TermsManager.tsx:145` (+ save/toggle) | Class-mode term management writes directly to Supabase `terms`, ungated. |
| F11 | `components/ClubAnnouncementDialog.tsx:103` | Zod `.uuid()` on ID fields rejects principal-text IDs (reported by II audit; relax to `.string()` where the field can be ICP-routed). |

### False positives checked and cleared (do NOT "fix" these)
- `ChangePasswordDialog.tsx` — gated by parents: `SettingsPage.tsx:532` (`{!isIcpAccount && ...}`) and `ProfilePage.tsx:673,945` (`{!isIcpAuth && ...}`).
- `hooks/useEventGroupSync.ts:235` — gated at line 16-17 (`isSupabaseEventGroupSyncDisabled` = ICP auth or events routed).
- `hooks/useUserPresence.ts:219` — gated at line 307 (`isFeatureRoutedToIcp("messaging")` early return).
- `features/news/useClubNews.ts` — `resolveLocalAuthMode` is aliased to `live/localRuntimeMode.ts` which **always returns false** in live builds; real routing happens via `withFeatureBackend("news", ...)`.
- `FindOrCreateClubWizard.tsx` — gated via `assertSupabaseWritePath` (lines 123/202).
- `PendingInviteWelcomeDialog.tsx` — gated via `isFeatureRoutedToIcp("membership")` (line 244).
- `hooks/useAuth.tsx` getSession / `lib/prefetchData.ts` — unreachable for II users (IcpAuthProvider path).

## Internet Identity integration — PASSED
- Correct `@icp-sdk/auth` provider object + `/authorize` path; popup-blocker-safe client warming; per-origin principals (no `derivationOrigin`); mainnet II URL hardcoded correctly; sign-out clears identity + agent cache + entitlements; session re-hydration with graceful expiry; `verify-iap-receipt-icp` is session-free (`verify_jwt = false`, HMAC attestation, principal from body). One minor note: some Supabase-side caches (roles/club-team) may survive II sign-out — low risk.

## Integration layer (frontend/src/live) — PASSED
- HttpAgent cache keyed per target+principal with handshake-failure eviction; routing config has Supabase → env → localStorage precedence so ICP mode boots even if Supabase is down; missing canister IDs fall back at the router level (no crashes); import-cycle rules respected; App.tsx gates first paint on placement load. Wrappers consistently map candid optionals/Nat64. Note: `events.ts`/`news.ts` field mappings are still marked provisional — verify against deployed Wasm before routing mainnet traffic.

## Recommended fix order
1. Constant-time HMAC compare (identity_access) — tiny patch.
2. ~~Governor-at-install for all 14 Motoko canisters (or scripted initialize-at-deploy) — must be settled before mainnet deploy.~~ **FIXED 2026-10-01**: deploy-script rule added to `backend/AGENTS.md` + `transfer_governorship` safety valve added to all 13 canisters.
3. Gate F1–F11 frontend paths.
4. `register_pii` re-check/lock.
5. identity_access StableBTreeMap migration.
6. Unbounded-array → Map/Buffer migration across Motoko canisters (largest piece; plan per-domain).
7. Cycle monitoring hooks + freezing thresholds.
