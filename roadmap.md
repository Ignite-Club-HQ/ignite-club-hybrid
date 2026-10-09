# Roadmap — ICP speed-up part 2
- [x] Match legal/contact links across sign-in modes; repair profile and internal policy destinations; 24 tests passed and all five pages plus profile policy links opened in browser (full signed-in profile/native-device check requires account/device access)
- [x] Refine login with platform-neutral embedded-browser and error guidance; text-only provider attribution retained; 29 checks and live normal/embedded-browser presentation verified
- [x] Simplify ICP login presentation without changing authentication; 49 regression checks passed; browser layouts, popup opening and cancellation verified
- [ ] Confirm real Internet Identity account sign-in on physical Android/iOS, installed apps/PWA and Facebook/Messenger — requires device access and user approval for an account sign-in
- [x] Shared batching helper (live/features/batching.ts)
- [x] Events batched reads (list_events_multi, get_event_rosters, list_duties_multi)
- [x] Messaging batched reads (mute prefs, group metadata, groups by clubs)
- [x] Names / child names — already batched + cached, no change needed
- [x] Mini-league + sponsor batching (competitions/media/vault/points had no per-item fan-out)
- [x] Optimistic RSVP on event cards (chat send/reactions already optimistic)
- [ ] Chat-open bundle (messages+reactions+pins) — low gain: those calls already run in parallel
- [ ] Idle prefetch of Schedule/Messages after Home
- [ ] Call-count instrumentation — measure after mainnet deploy
- [x] Fix Dingo U8 event create going to Supabase (II users stay on canisters)
- [x] Photo storage sharding (needs mainnet deploy for fullness limits)
- [x] ICP Children page: add/remove children, team assignment, guardians (club_domain parent self-service methods; needs mainnet redeploy)
- [x] My Roles (ICP): real club/team names, hide deleted clubs

## Frontend on ICP / retire Netlify
- [x] Remove GIPHY endpoint (app reads key from Placement Settings)
- [x] Link previews → messaging canister for all users (needs messaging_domain redeploy; Netlify fallback until then)
- [ ] Club-website registration endpoint home — still on Netlify (needs a secret-holding server)
- [x] Frontend canister config, packaging (headers, cache, SPA fallback), deploy workflow
- [x] First deploy done — frontend canister live at proe7-kqaaa-aaaas-qg6gq-cai.icp0.io / .icp.net, app boots, deep links fall back, assets + headers verified
- [x] Canister site keeps its OWN accounts (user decision 2026-10-07): no derivation origin for *.icp.net/.icp0.io addresses; account migration planned when a custom domain fronts the canister
- [x] Canister security rules widened for IP-country detection and address search; video embeds repaired (needs one more canister deploy)
- [ ] Supabase Auth redirect allow-list needs the canister URL (user)
- [ ] Review codemagic.yaml (user to share)
- [ ] Side-by-side test, move custom domain, delete Netlify

## Native apps (Codemagic)
- [x] codemagic.yaml: android-debug, android-release, ios-debug (simulator, unsigned), ios-release (App Store IPA); native projects scaffolded in CI, not committed
- [x] @capacitor/cli + @capacitor/android + @capacitor/ios devDependencies, lockfile refreshed
- [ ] User: connect repo in Codemagic, run android-debug then ios-debug (zero secrets)
- [ ] User: android_release secrets (keystore + google-services.json) for Play
- [ ] User: Apple Developer Program + App Store Connect integration named `ignite` + APP_STORE_APP_ID for TestFlight
- [ ] Push on native: install @capacitor-firebase/messaging (absent today, so nativePush silently no-ops) + APNs key in Firebase
- [ ] Deep links for store release: Android intent filters + iOS AASA/associated-domains on the published domain

## Country-based backend routing
- [x] Per-club overrides removed; club home country + locked backend recorded on Supabase clubs
- [x] Sign-in screen follows visitor country; ?auth= override kept for testing
- [x] club_domain records club home country (set-once for admins, governor can correct; batched read) — needs mainnet redeploy
- [ ] Backfill home country for existing ICP clubs (Chick Burgers, Winter Cats, Kitty Kats) via governor call after redeploy
- [ ] Regional backends (EU Supabase project / ICP Cloud Engine) — future ops task

## Move account to new sign-in ID (plan 2026-10-09)
- [x] rekey_principal on identity_access (Rust)
- [x] rekey_principal on club_domain, events_domain, messaging_domain
- [x] rekey_principal on vault_domain, notification_queue, pii_access_control, media_blob_store
- [x] rekey_principal on media_metadata, mini_league_domain, competition_domain, club_points_domain, insights_domain
- [x] .did + bindings regenerated, drift check clean
- [x] scripts/move-account.mjs + move-account.yml workflow
- [x] AGENTS.md rule
- [ ] User: top up, run blockchain update, run move workflow (dry run then confirm), sign out/in on laptop
