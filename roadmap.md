
## Tasks
- [x] Admin ICP canister configuration screen (app_settings-backed)
- [x] Backend routing admin: global Supabase/ICP default + per-country eligibility (app_settings `backend_routing_config`); profile `country` column + Edit Profile selector; IP fallback
- [x] Consolidate canister config + backend routing into Infrastructure / Placement Settings (/admin/placement-settings); removed duplicate lab placement panel and old /admin/icp-canisters page (old path redirects)
- [x] Auth screen follows placement settings: /auth shows Internet Identity when ICP is the effective backend (live/authBackendMode.ts); App gates first paint on config load
- [x] Approved targets: per-backend target registry (region/kind/version/enabled) + per-country target pinning in the routing config; resolver `resolveTargetForCountry`/`getEffectiveTarget`
- [x] Per-feature hybrid routing: live/featureBackend.ts maps each feature area to its canister (with per-canister Supabase fallback); live/featureRouter.ts `withFeatureBackend` dispatches Supabase vs ICP per feature; typed connectors for all 12 remaining canisters in live/domains.ts + per-feature services in live/features/
- [x] Wire read consumers: events (event detail + RSVPs), home (RSVP reads), media (feed, reactions, comments), messaging (group messages), news (feed + post). ICP branches are provisional mappings — canister shapes lack timestamps/joins; verify against deployed canisters
- [x] Dry-run preview in Placement Settings: "Simulate all canisters configured" toggle shows per-feature backend now vs after deploy, plus the sign-in screen result — pure client-side projection, no writes or canister traffic
- [x] ICP deployment runbook at docs/icp-deployment-runbook.md (deploy, register IDs, routing, verification, rollback)
- [ ] Pre-mainnet fix 1: canister-driven migration orchestration (coordinator makes inter-canister export/import/reconcile calls; domain canisters accept the coordinator principal for bulk operations) — in progress
- [x] Pre-mainnet fix 2: real PII encryption in pii_access_control — raw_rand master secrets per key id, SHA-256 CTR keystream + encrypt-then-MAC tags, random 12-byte nonces, keyed derive_media_key. CAVEAT: not yet compiled (no moc here) — before mainnet, compile with moc 1.14.0 and run the SHA-256 test vectors + encrypt/decrypt round-trip + tag-tamper tests. Longer-term: vetKeys/HSM custody.
- [ ] Pre-mainnet fix 3: timer_jobs incremental stable storage (StableBTreeMap for jobs instead of rewriting whole state per change) — in progress
- [x] Pre-mainnet fix 4: migration coordinator README language claims corrected + canister-driven orchestration sketch added
- [ ] Wire remaining features once their canister APIs cover browser paths: membership (club_domain teams/ACL), competitions (no round/match-list queries), notifications (worker-facing queue), vault (pii_access_control records not yet used by vault UI)
- [ ] Verify ICP branches end-to-end after canisters are deployed (Internet Identity sign-in + live canister calls)
- [ ] User deploys canisters; enter IDs via /admin/placement-settings or IGNITE_LIVE_ICP_CANISTER_IDS_JSON
- [ ] Confirm Internet Identity as canister auth before building authenticated update calls
