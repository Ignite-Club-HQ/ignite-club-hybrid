# Deep-audit round 2 — fix implementation plan

Source: docs/icp-audit-2026-10-01-deep-round2.md (all findings verified in source).
Standing rules: no "not available" UI states; only iOS IAP works in ICP mode (other payment paths stay gated/blocked); wire real data or record NEEDS-CANISTER.

## Phase 1 — Canister security patches [DONE]

1. [DONE] identity_access/src/lib.rs:1157 — replace `expected != signature_hex.to_lowercase()` string compare with constant-time byte comparison of decoded HMAC. Verify with cargo check + existing tests.
2. [DONE — FALSE POSITIVE] pii_access_control register_pii TOCTOU (src/main.mo ~279-324) — re-check for an existing record AFTER the `await* random_bytes(...)` inter-canister call before appending, so concurrent registrations can't duplicate a pii_id+field_id record. Compile with moc --enhanced-migration.
3. [DONE — fallback path] Governor race (all 14 Motoko canisters): one-shot confirmed already enforced; transfer_governorship added to all 13; initialize-at-deploy rule in backend/AGENTS.md; drift 17/17. Original text: — investigate actor-class install argument under --enhanced-migration on one canister (club_domain). If supported: convert `initialize()` first-caller-wins to install-arg governor with initialize kept only as a migration-path no-op for already-initialized state. If not supported: restrict initialize to a one-time call plus document scripted initialize-at-deploy as the operational control, and add a `transfer_governorship` guard. Compile all touched canisters.

## Phase 2 — Frontend gates F1–F11 (from audit table) [DONE — verified on disk; NEEDS-CANISTER items recorded in frontend/roadmap.md]

- F1 NextUpCarousel useChildRsvps: gate the children/child_guardians queries for II users; route RSVP reads through the events canister wrapper (getLiveEventRosterDetailed) where household RSVP data is needed, else skip the query for principal-text IDs. Never pass a principal to a uuid column.
- F2 AccountRecoveryBanner: gate the profiles status query to Supabase-auth users only (resolveAuthBackend).
- F3 AddClubAdminSheet: gate existingMembers/clubBranding/search_invitable_profiles lookups; use club_domain role grants (list_role_grants / my_role_grants) for the member list when membership is ICP-routed.
- F4 AddressAutocomplete: gate the google-places-search invoke for II users; fall back to the plain manual text input (no placeholder banner).
- F5 AssociationEventsPanel: gate association-create-club-event invoke; if the events canister has no association-scope create, record NEEDS-CANISTER and gate.
- F6 MemberSubscriptionPaymentsManager: gate "Mark Paid" and "Send Reminders" for ICP mode (non-IAP payments are Supabase-only by standing rule).
- F7 PlayHQTeamLinkCard: gate teams.update + playhq-materialise-team-events invoke for ICP mode.
- F8 PlayerOfMatchSelector: move notification inserts + child lookups inside the withFeatureBackend points gate (or gate them on the same condition).
- F9 SponsorOrAdCarousel: gate auth.getUser/user_roles/sponsors lookups for II users; read sponsor data via insights/club canister wrappers if a shape exists, else gate.
- F10 TermsManager: gate class-mode term writes for ICP mode; check whether club_domain terms belong to an existing canister shape before deciding wire vs gate.
- F11 ClubAnnouncementDialog: relax Zod .uuid() to .string() on ID fields that can carry principal-text IDs under ICP routing.

## Phase 3 — Deferred (recorded, not done this pass)

- identity_access StableBTreeMap migration (HIGH, large) — separate plan.
- Unbounded-array → Map/Buffer migration across Motoko canisters (HIGH, largest) — per-domain plan.
- migration_coordinator parallel awaits; timer_jobs unwrap/expect hardening; cycles_balance() monitoring hooks (MEDIUM).

## Verification per phase

- Motoko: moc --enhanced-migration --check on every touched canister; regenerate .did + bindings if interfaces change; drift check 17/17.
- Rust: cargo check --target wasm32-unknown-unknown + existing tests.
- Frontend: tsc clean; targeted vitest for touched files; preview build OK.
