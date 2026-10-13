## Move everything except payments on-chain (2026-10-13)
- [x] Scheduled messages: manage page + photo attachments on ICP
- [x] Club weekly schedule broadcasts on ICP
- [x] Delete group chat on ICP
- [x] Team creation requests on ICP
- [x] Home team/league access requests on ICP
- [x] Publish chat photo to gallery on ICP
- [x] Monogram logo generator on ICP
- [x] Player list export on ICP
- [x] Fixture import on ICP
- [x] Short invite links on ICP
- [x] Export data / delete account on ICP
- [x] Chat search (DM, club-admin, broadcast) on ICP
- [x] Admin pages: update reminders, backups, realtime health, AI catch-up, AI model test, video guides
- [x] Verify + move: vault permanent delete, role request approval, passkey settings, Drive import, legal re-acceptance
- [ ] Redeploy changed canisters + frontend (user-run workflows)

## ICP chat device files
- [x] Replace silent device-file no-op with encrypted upload, vault registration, and visible progress/error feedback.
- [ ] Confirm on Paul's phone — requires updated Android app and device access.

## ICP DM role preferences
- [x] Read saved roles from ICP; retain Coach after saving and preserve attachment restrictions.
- [ ] Confirm on Paul's phone — requires the updated Android app and device access.

## ICP club chat preview
- [x] Read club/team previews directly by scope ID and retain photos when sender lookup fails; 11 tests passed.
- [ ] Confirm Giddy Goat on Paul's phone — requires the updated Android app and device access.

## ICP Messages DMs filter
- [x] Keep DMs reachable under All, including no existing direct conversations and small inboxes.
- [ ] Confirm on Paul's phone — requires the updated Android app and device access.

## ICP calendar date error
- [x] Validate timestamp ranges and cached dates before calendar formatting; 13 regression tests passed.
- [ ] Confirm “All clubs” on Paul's phone — requires the updated Android app and device access.

## Native sign-in bridge audit
- [x] Replace orange with Ignite green; fix provider reply origin, return link and cancellation handling; 15 tests and browser opening/retry pass.
- [x] Fewer taps: Internet Identity opens automatically; Android return uses a package-targeted intent link; reply survives Android closing the app (cold-start launch link). 18 tests pass.
- [x] No pop-ups: bridge sends the page to Internet Identity and back (redirect), return address allow-listed; app waits 6s before calling it cancelled. 6 bridge tests pass.
- [ ] Live canister still serves the old orange page (verified 2026-10-12) — "Deploy web app (ICP frontend canister)" GitHub workflow must run; then new Android build + phone confirmation.

## Android status bar
- [x] Remove duplicate Android top spacing and repaint the backdrop after system icon styling; 12 frontend and two Android scaffold checks passed.
- [x] Correct native status-bar background in both Android builds; actual Capacitor scaffold checks and light/dark/viewer regressions pass (four tests).
- [ ] Confirm on Paul's phone — requires a new Codemagic build and device access.

## Duplicate chat photo after returning
- [x] Reconcile restored uploading-photo bubbles with confirmed messages; leave/return/refetch regressions and failed-send recovery passed (29 tests).
- [ ] Deploy the frontend update and confirm on Paul's phone — requires the user's deployment and device access.

## Spreadsheet opening
- [x] Ensure stored documents are decrypted before opening/downloading and retain spreadsheet filenames/types; binary-preservation regressions added.
- [ ] Deploy the frontend update and reopen Paul's existing spreadsheet on his phone — requires the user's deployment and device access.

## ICP reward saving
- [x] Connect rewards to verified club roles and preserve form errors; five frontend tests, role-isolation tests, canister check and contract drift check passed.
- [ ] Deploy updated club_points_domain and frontend canisters, then verify Add Reward signed in on a phone — blocked on the user's GitHub deployment and Internet Identity session.

## Sign-in image loading
- [x] Wait for restored sign-in before unlocking ICP images and share repeated logo requests; add regression tests.

# Roadmap — ICP speed-up part 2
- [x] Show the actual uploader name after ICP media uploads, including linked/moved accounts and cached signed-in profiles; three regression tests passed (frontend update required)
- [x] Recognise complete ICP event IDs in shared chat cards and message previews; ten event-ID regression tests passed (frontend update required)
- [x] Recover saved header logos after refresh-time ICP unlock failures without requiring another refresh; three resolver tests passed (frontend update required)
- [x] Recognise complete ICP poll IDs in chat cards, card-only messages and inbox previews; seven attachment-ID tests passed (frontend update required)
- [x] Align ICP profile-photo and theme confirmations with saved, refreshed display; prevent overlapping saves and reuse uploaded photo previews
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

## Close remaining ICP gaps except payments (2026-10-13)
- [x] Seasons, team/role requests, invite edit/move, folders, classes, associations, club theme, free usage
- [x] Events: POM, captains, goalkeepers, player stats, event views, favourites, mini-league RSVPs, pitch board save/unlink
- [x] Chat: read receipts, AI catch-up, queued replay, content reports, desktop rail
- [x] Stats/rewards: team leaderboards, real Pro check, points switch; account: theme, switcher hint, admin delete; vault delete + auto-copy
- [ ] Leftovers still marked in code: saved places, live pitch board view/alerts, per-club badges, notification chat routing/club switch, gallery publish from chat, early-RSVP points, team role notifications, positions jersey/multi, second-parent invites, guardian fields, invite email dedupe, home invite lookup, team carousel fields, rewards manager icon/team overrides, PlayHQ
- [ ] User: redeploy club, events, messaging, identity canisters + frontend canister + Android build
