# Close the ICP coverage gaps from the Codespaces test

The Codespaces test listed 29 features with no secure-sign-in (ICP) path, plus 5 partly working or unchecked areas. Its test files aren't in this project, so step 0 brings in an equivalent check. Then each gap gets one of three outcomes: **build it on-chain**, **keep it off-chain on purpose** (with a test showing it's hidden cleanly, not broken), or **blocked** (with the reason).

## Step 0: A checklist test the gaps must pass
- Add a test that lists every feature and requires each one to have either a real ICP path or an approved off-chain reason. The 31-item list from Codespaces becomes the starting failures.
- Fix the shared failure in `EventsPage.icp-roster.test.tsx`: ordinary members can't see public fixtures.

## Group A: Kept off-chain by earlier decisions (no build, prove they're hidden cleanly)
These follow your "everything on-chain except payments" rule and the earlier approved exceptions:
- 6 App payment configuration, 12 Promo codes (the on-chain part already exists, so only the test is added), 13 Subscription management (iOS/Android purchases only), 15 Fee payments, 22 Payment settings
- 5 Temporary passwords, 18 Password recovery / reset codes (Internet Identity has no passwords)
- 1 AdMob settings, 29 Team-admin **email** invitations (email sending is off-chain; join links already work on-chain)
- 10 External fixture import: on-chain for PlayHQ team fixtures. Association-linked imports stay off-chain.

For each one, a test checks that ICP mode hides the feature or shows a proper alternative, never an error.

## Group B: Build on-chain (worth doing first, used every day)
1. 7 Club editing, 8 Team editing: send the saves to club_domain and add the missing fields there.
2. 9 Personal team creation: create the team on club_domain with no club attached.
3. 16 Public competition pages: add a public read on competition_domain that returns fixtures and ladder only.
4. 21 Short invite resolution: look up the code on club_domain.
5. 24 Account deletion: remove the caller's profile and roles on-chain. Records owned by the club stay.
6. 25 Chat vault pinning, 26 Publishing chat images to the gallery: messaging_domain plus media_metadata.
7. 27 and 28 Pitch-board event-link and formation alerts: reuse the notification_queue fan-out.
8. 14 Schedule broadcasts, 19 Scheduled messages: store them on-chain and send them from the existing events_domain timer.

## Group C: Admin tools (build lightweight on-chain versions)
- 2 AI catch-up admin, 3 Photo-reminder admin, 20 Update reminders, 23 Admin video guides: keep their settings in club_domain app_config, the same way GIPHY and app settings already work.
- 11 Backup admin: show the snapshot and health status in read-only form. Restoring stays a GitHub workflow.
- 17 Realtime health: show the canister health page in its place.

## Group D: Blocked or not offered
- 4 LLM testing: the app can't safely hold the AI key (decided earlier), so it stays hidden in ICP mode.

## Partly working areas to confirm with tests
- Competition welcome-email settings: ICP stores the settings, but the email itself is sent off-chain. Fix the misleading positive test in `WelcomeEmailSettingsCard.test.tsx`.
- Public fixtures shown to ordinary members (the Step 0 fix).
- Recipients can unlock and see photos in team and competition chats: test the club read grant.
- Ladder visibility setting, and score entry refreshing the ladder: extend the tests that already exist.
- Team creation, role assignment and invites: replace source-text checks with behaviour tests.

## How each batch is checked
For each batch: write a failing ICP test, build the smallest change that passes it, run the ICP test and its Supabase twin, then run strict TypeScript. Canister changes compile with moc and update the bindings. They go live after a mainnet deploy, so top up cycles first.

## Technical notes
- New canister state goes only in new, later-dated migrations. Existing migration files stay unchanged.
- Batch order: Step 0, then B1–B4, then B5–B8, then C. Each batch ships separately.
- The final report lists features now covered, features still blocked with the exact test names, and test results. It won't claim the full suites match unless both full suites were run.
