# Codespaces ICP coverage: first verification batch

Verified 2026-10-17 UTC. The pushed tests are now in the project. This is a focused test report, not a claim of full-suite parity or live deployment.

## Fixed and positively covered

- `EventsPage.icp-roster.test.tsx > EventsPage roster-derived team scope routing > shows public competition fixtures to an ordinary member without an organizer-club role`: now passes in both runner modes. Fixed a misspelled competition lookup that prevented the public read, unresolved promises used as team names, and a missing date-formatter import that crashed the fixture card.
- `ShortInviteRedirect.test.tsx > ShortInviteRedirect ICP boundary > resolves an on-chain code anonymously and opens the invite without Supabase`: passes. The existing anonymous club_domain lookup is exercised by the page test.
- `ShortInviteRedirect.test.tsx > ShortInviteRedirect ICP boundary > rejects an unknown on-chain code without resolving a Supabase short code`: passes. Replaced the obsolete expectation of an unavailable screen with a stronger behavior check of the supported on-chain lookup and its rejection.
- `ShortInviteRedirect.test.tsx > ShortInviteRedirect ICP boundary > returns to sign-in instead of spinning forever when no invite is returned`: failed before the implementation, now passes after explicitly handling empty results.
- Existing Supabase short-link success, failure, URL encoding and late-response checks remain intact and pass.

## Recorded focused results

Command: `node scripts/run-tests-recorded.mjs --output-dir=/tmp/icp-step0-final src/pages/EventsPage.icp-roster.test.tsx src/pages/ShortInviteRedirect.test.tsx src/components/WelcomeEmailSettingsCard.test.tsx src/test/icpFeatureParityGaps.test.ts`.

| Mode | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Supabase | 9 | 0 | 36 |
| ICP | 25 | 14 | 6 |

The gap sentinels and competition welcome-settings test were retained. Their failures are not hidden or reclassified to make this run green. Passing source sentinels alone do not establish positive behavior coverage.

## Remaining exact failing test names

`WelcomeEmailSettingsCard.test.tsx > WelcomeEmailSettingsCard > loads and saves competition settings through the competition canister`.

The competition path currently uses Supabase. No equivalent welcome-settings method/state exists in competition_domain or its current generated contracts. It needs an authorized on-chain read/write, a new migration, regenerated bindings and a canister upgrade; adding frontend-only helpers would falsely claim support.

All following failures belong to `icpFeatureParityGaps.test.ts > ICP feature parity gap sentinels`:

- `ICP parity: AdMob settings must have a live implementation`
- `ICP parity: temporary passwords must have a live implementation`
- `ICP parity: application payment configuration must have a live implementation`
- `ICP parity: club editing must have a live implementation`
- `ICP parity: team editing must have a live implementation`
- `ICP parity: personal team creation must have a live implementation`
- `ICP parity: subscription management must have a live implementation`
- `ICP parity: promo-code redemption must have a live implementation`
- `ICP parity: fee payments must have a live implementation`
- `ICP parity: public competition pages must have a live implementation`
- `ICP parity: password recovery must have a live implementation`
- `ICP parity: reset-code verification must have a live implementation`
- `ICP parity: payment settings must have a live implementation`

Payment processing/password boundaries remain intentionally separate from the work to make plans, entitlements, invitations and ordinary settings usable on-chain. These source-marker failures require actual behavior investigation; they are not proof that all named live flows are missing. No new Supabase exception was introduced.

## Verification limits and next batch

- Preview build log reports `build OK` after the changes.
- No manual strict TypeScript run was performed: the environment reserves build/typecheck execution for the harness. The project's named strict configuration only includes observability and CSV files, so that configuration alone would not verify these changed pages.
- No Candid, Motoko, migration or generated bindings were changed in this batch; no compiler or canister deployment is claimed.
- Page tests exercise rendered navigation with mocked canister responses. Real Internet Identity sign-in and live canister read-back were not exercised.
- Next batches remain club/team editing, personal teams, public competition pages and competition welcome-settings storage, followed by the other approved coverage groups. Full ICP and Supabase suites have not been run.
## Batch 2 (2026-10-17): club/team editing, personal teams, public competition pages
- Club editing, team editing, personal team creation: real ICP save paths already existed (withFeatureBackend -> club_domain); the sentinel markers were synthetic-fixture lab-preview notices, reworded. Register entries -> onchain.
- Public competition pages: new anonymous query get_public_competition_page on competition_domain (competition + matches + ladder-visibility, public+non-archived only); .did and both binding dirs regenerated; IcpPublicCompetitionPage renders fixtures and an on-device ladder (computeLiveLadder, PublicCompetitionPage.ladder.test.ts, 4 tests). Requires competition_domain mainnet redeploy before live use.
- Focused run (both modes): Supabase passed; ICP 28 passed, 9 failed, 13 todo. Remaining 9 failures are the approved off-chain exceptions (AdMob, temp passwords, app payment config, promo redemption, subscription management, fee payments, password recovery, reset codes, payment settings) — next batch replaces them with hide-cleanly tests.
- Pre-existing unrelated drift: vault_domain bindings have 4 extra methods vs its .did (not touched here).

## Batch 3 (2026-10-17): off-chain exceptions reclassified as hide-cleanly tests
- The 9 remaining ICP sentinel failures were the approved off-chain exceptions (AdMob settings, temporary passwords, application payment configuration, subscription management, promo-code redemption, fee payments, password recovery, reset-code verification, payment settings).
- New `src/test/icpOffchainHides.test.ts` (9 tests, ICP mode only) asserts each page shows its clear "unavailable" notice — the clean hide IS the correct behaviour; a missing notice now fails loudly with instructions to update the register.
- Those 9 entries removed from `icpFeatureParityGaps.test.ts` sentinels; remaining sentinels cover the still-open todo groups.
- Focused run both modes: Supabase 2 passed / 31 skipped / 13 todo; ICP 33 passed / 13 todo. Zero failures in either mode.

## Batch 4 (2026-10-17): scheduled-message security and schedule broadcasts
- Closed a genuine security gap: schedule create/list/update/cancel now require the author to equal the authenticated caller. Previously another signed-in caller could supply someone else's author ID. Existing worker-only delivery methods remain worker-only.
- Photo-only schedules no longer fail the canister's nonempty-text check; editing still rejects a message with neither text nor a photo.
- Schedule-refresh fan-out now checks live club roles (club/app/league admin or the target team's admin/coach) inside notification_queue; missing role service or failed verification denies the operation.
- Added executable Motoko ownership and scope-isolation tests, and frontend behavior tests for recipient deduplication, denied writes, session requirements, photo/reply references and both backend paths. Foreground schedule refresh remains periodic polling, not a realtime event stream.
- No API signatures or stored state changed, so no migration or binding regeneration is needed. The notification_queue must be upgraded before its security and photo-only changes apply live.
- Coverage entries remain TODO deliberately: calendar-month recurrence still uses 30 days; explicit attachment/recurrence-end clearing and complete timer/read-back coverage are not verified. Broadcast recipient validation and real event-triggered refresh also remain open. This batch does not claim those complete.
- Real Internet Identity signed-in create → timer delivery → chat read-back was not available in this sandbox; tests use mocked frontend canister responses and executable pure canister guards. No full-suite parity claim.

## Batch 5 (2026-10-17): calendar recurrence and explicit field clearing
- Monthly schedules advance by a UTC calendar month, preserving the time and clamping to the next month's last day. Subsequent repeats use that clamped day (Jan 31 → Feb 28 → Mar 28), rather than a fixed 30-day step. Daily/weekly catch-up skips elapsed slots arithmetically; recurrence end dates remain inclusive.
- Updates distinguish omission from explicit removal: omitted Candid options preserve the saved field, empty image text clears an attachment, and a zero recurrence-end timestamp clears the end date. The hook preserves explicit nulls. No Candid signatures or stored-state shapes changed.
- Executable Motoko tests cover leap February, December rollover, month-end clamping, elapsed slots, inclusive end dates and keep/clear/replace behavior. Existing ownership tests and notification_queue compile check pass; compiler warnings remain (Nat arithmetic/conversion and pre-existing stable-memory deprecation).
- Focused frontend run: Supabase 22 passed / 12 skipped; ICP 16 passed / 18 skipped across three test files. The live argument-mapping tests call the real adapter with a mocked actor; hook tests check explicit clears survive forwarding.
- Requires notification_queue upgrade before the new clearing and recurrence behavior works live. Actual signed-in timer delivery/read-back, broadcast recipient relationship validation and event-triggered refresh remain open; coverage entries stay TODO and full-suite parity is not claimed.

## Batch 6 (2026-10-17): schedule signals, account access, chat pins and gallery copies
- Schedule fan-out verifies each recipient's current club/team roles on club_domain before any notification write. New caller-scoped get_schedule_refreshes query returns the latest queued signal per club/team; foreground polling invalidates only when its key changes (still up to 30-second latency, not WebSocket realtime).
- Fixed the actual vault-read gap: useChatPinnedVault disabled its query in ICP mode despite having adapters. Reads are now enabled and poll when subscribed. Saves require an explicit club ID instead of guessing a club from a team-root ID. Canister writes reject cross-club files/folders, club-root mismatch and changing an existing chat's club scope.
- Self-service account erasure already existed. New club_domain erase_my_membership revokes all linked principals' roles before identity_access erasure and excludes existing clubs to block family-derived membership, retaining shared club/team records and children. Governor accounts are protected. Failures prevent profile erasure and are surfaced; retries are possible. Per-user content purge and admin account deletion remain incomplete and the UI discloses this.
- Gallery publication now unlocks the source photo, copies authorized plaintext through the established encrypted upload path into gallery-owned storage, and registers that copy. Never interprets ciphertext as image bytes. Failed scope assignment deletes the gallery row and reports failure rather than publishing to the wrong audience. Existing source-reference and deterministic-copy checks prevent repeat publication; concurrent calls are not yet atomically deduplicated.
- Focused six-file run: Supabase 49 passed / 15 skipped; ICP 29 passed / 35 skipped. Includes real adapter/hook behavior with mocked canister responses and UI account confirmation. Executable Motoko scope and role-removal tests pass; notification_queue and club_domain compile checks pass (existing warnings). Vault check recorded separately after its final changes.
- Updated notification_queue, club_domain and vault_domain Candid/bindings; regenerated vault_domain's stale contract from its current source. Drift check passes all 17 active contracts. No new state/migrations. Upgrade notification_queue, club_domain and vault_domain, then deploy the frontend. Deployment credentials/GitHub workflow access and a real Internet Identity session were unavailable; no production deploy or signed-in timer/read-back claimed. Full-suite parity not claimed.

## Batch 7 (2026-10-17): pitch-board alerts and linked-match reads
- Completed existing ICP branches: link alerts include match Subs Manager and saved coach/team-admin/Subs-Manager flags; formation alerts preserve current-user + staff + Subs-Manager recipients. Shared resolver deduplicates IDs, excludes link author, resolves actual club ID and verifies linked event team scope.
- Event-group boards read on-chain Referee + Subs Manager duties, checking group belongs to linked event first. Unlinked group formation changes cannot resolve an audience and contain the error; no unrelated duties used.
- Linked-event details, opponent label and 24-hour auto-unlink now read events_domain, not Supabase. Shared role-flag loader reads club_domain in ICP mode.
- ICP alerts use existing pitch_board category for pitch preferences/board-opening behavior; related ID is board team/group ID. Formation bodies omit child names because notifications store plaintext.
- Initial three-file tests: Supabase 25 passed / 2 skipped; ICP 22 passed / 5 skipped. Covers flags, author inclusion/exclusion, dedupe, exact-match duties, group ownership, missing club, opponent/expiry and no Supabase reads. Mocked adapter behavior, not production delivery verification; final expanded run recorded in test logs.
- No canister contracts/state changed; deploy frontend, with prior canister upgrades still outstanding. Real signed-in delivery/tap checks blocked on deployment/session. Admin tools, competition welcome storage and per-user content purge remain open; no full-suite parity claim.

## Batch 8 (2026-10-17): competition welcome storage and admin reminder controls
- Competition welcome settings now load/save on competition_domain rather than falling through to Supabase. New migration 20261020_000000 adds only the settings collection; previously applied migrations remain unchanged. Settings are included in governor-gated export_state (schema 6).
- Reads and writes reject anonymous callers, refresh live organiser-club roles, require competition management permission and reject missing competitions. Subject is nonblank and at most 160 characters; message at most 4000. Settings replace the existing competition row rather than accumulating copies. Club-admin mirror refresh now revokes stale grants if the role service is unset or fails, including sibling competition management paths.
- Fixed the real photo-reminder UI gap: Run now was disabled despite a complete ICP handler. It now invokes the existing app-admin-gated messaging_domain runner; tests exercise settings saves, returned counts, denied access and errors without Supabase. Automatic reminder cadence is not verified or completed here.
- Existing ICP canister-reachability tests pass; this is polling/latency health, not Supabase websocket metrics. AI catch-up administration, full backup scope, update-reminder fan-out and video-guide behavior tests remain open; static AI execution remains blocked.
- Five-file focused run: Supabase 14 passed / 3 skipped / 8 todo; ICP 15 passed / 2 skipped / 8 todo. Executable Motoko welcome tests and full competition_domain compile pass (existing deprecation warnings). Candid and both binding directories regenerated; drift check passes all 17 active contracts.
- Requires competition_domain upgrade and frontend deployment. Competition welcome email delivery is NOT implemented by settings storage: joins have no authoritative recipient/job path yet. No deployed signed-in read/save/read-back or reminder delivery test was possible without deployer/workflow access and a real Internet Identity session. No production deployment or full-suite parity claim.

## Batch 9 (2026-10-17): admin controls — focused verification
- Direct app-admin gates added to AI recap and ICP update reminders, preventing reads before role resolution. These UI guards do not replace canister authorization. Vault backup methods already independently reject callers without a local app-admin grant.
- AI rollout adapters already existed. Behavior tests now cover setting saves, active/nondeleted/unexpired Pro eligibility, member enablement and rejected reads/writes without Supabase calls. Failed reads no longer display false defaults. Configuration coverage does not establish AI execution or remove the existing allowlist.
- Vault metadata backup list/create/download/restore/delete tested, including confirmation cancellation, label trimming, bigint/principal serialization and errors. Silent Supabase no-op handlers now throw explicit connection errors. Backups do not include encrypted file bytes or complete club archives; comprehensive parity remains open.
- Update reminders deduplicate role holders, split at 500 recipients and report actual canister-created counts as **queued**, not delivered. Failed/unfinished club discovery disables sending. Tests cover empty audiences, batching, rejection and admin denial without Supabase calls. Platform/version targeting, minimum-version settings, test-send parity and independent canister manager/recipient checks remain open: generic fan_out currently verifies those relationships only for schedule_refresh.
- Static recording-guide downloads need no external storage. Tests verify signed-out redirects, non-admin denial, restoration waits and text/PDF exports. Empty promo-video sources remain unchanged and playable videos are not claimed.
- Seven-file focused run: **32 passed in Supabase runner mode; 32 passed in ICP runner mode**. New page tests exercise mocked ICP adapters in both modes, not Supabase-path twins or live authorization. Preview log reports build OK. No methods, migrations or bindings changed.
- Frontend deployment and an Internet Identity admin session are still needed for live save/read-back and delivery checks. Prior canister upgrades, automatic photo reminders, competition email delivery, per-user purge and full-suite parity remain outstanding.

## Batch 10 (2026-10-17): update-reminder authorization
- notification_queue now reserves the update_reminder kind family in BOTH fan_out and direct enqueue. Both paths require independent app-admin verification and verify every recipient's current club membership through the configured club_domain before any queue record is written. Missing configuration, role-service failure, non-admin senders, anonymous recipients and cross-club audiences cannot enqueue update reminders. Other notification kinds retain their existing checks; this is not a global notification security audit.
- Recipient IDs from club_domain's roster are normalized from principal:<text> to bare principal text before deduplication, matching inbox/device-token owners. Frontend tests verify normalization, denial feedback, no Supabase fallback and existing batching/count behavior.
- Executable Motoko authorization tests cover valid admin/member access, non-admin/anonymous denial, cross-club rejection, a mixed valid/invalid audience, anonymous recipient rejection and denied admin checks. These exercise the same injected-check authorization module used by the queue, not a deployed multi-canister environment.
- Focused frontend run: **10 passed in each runner mode** (ICP page/adapters mocked in both, not Supabase-path parity). notification_queue mops check passes with existing warnings; authorization interpreter test passes; drift check passes all 17 active contracts. No public contract or stored-state changes; no migration or bindings needed. Preview build OK.
- Upgrade notification_queue and deploy the frontend before these changes apply live. No deployer credential/workflow access or real Internet Identity session was available; deployed admin send → queue read-back → phone delivery remains unverified.
- Platform/version targeting, minimum-version controls and store/prompt test sends remain open. DeviceToken currently has platform but no app-version/build metadata or admin audience API; implementing pretend filters would not provide parity. Comprehensive backups, automatic photo-reminder cadence, competition email delivery, per-user purge and full-suite parity remain subsequent stages.


## Batch 11 — 2026-10-18 UTC (partial closure; not complete parity)

- messaging_domain owns persisted photo reminder settings and an hourly, non-reentrant sweep. Disabled/24–48h window/7-day cooldown and invalid bounds have executable policy tests. Gallery-upload reminder taps now open the relevant team gallery.
- notification_queue adds caller-reported platform/version/build metadata, active-token filtering and app-admin/club-membership-gated audience reads. Update reminder UI supports exact iOS version/Android build filters, self-only test sends and saved minimum versions. Metadata is reported by devices, not trusted attestation. Targeting currently selects recipient accounts; it does not attest/filter every physical device at delivery.
- Admin deletion revokes club authority before identity erasure. It fails if safe membership resolution is unavailable. This is NOT a complete personal-data purge; shared and existing content remain, and the success message says so.
- Backup page exposes seven existing privileged domain exports without widening canister permissions. Vault metadata remains restorable separately. These exports are NOT a complete restorable backup of club configuration or encrypted media bytes.
- Fixed a genuine push worker/Candid mismatch: list_device_tokens returns an Ok/Err variant, not a bare vector. Worker now unwraps token reads and checks recovery/ack/retry results instead of claiming success on denied results.
- Final focused run: 14 files passed in each mode; Supabase 88 passed / 2 skipped / 3 todo; ICP 81 passed / 9 skipped / 3 todo. Skips are backend-specific tests, not a parity claim. Six executable Motoko test files passed (club 1, messaging 1, notification queue 4); all three canisters compile; 17-contract drift check passes; preview build OK.
- Full suites were run while changes continued, so they are a diagnostic mixed-revision baseline: Supabase 5313 passed / 80 failed / 192 skipped / 6 todo across 598 files; ICP 4779 passed / 78 failed / 731 skipped / 3 todo across 600 files. A final complete-suite rerun is still required. Exact failures are recorded in ICP_BATCH11_TEST_FAILURES.json. Legal setting mocks, missed notification routing mocks, pitch unlink mocks and gallery expectations were repaired subsequently and pass focused reruns; other failures remain untriaged/unfixed.
- Still incomplete: authoritative competition welcome recipient/job email delivery; complete recoverable backups; personal-content erasure; remaining suite failures. These are implementation work, NOT merely missing deployment credentials.
- Deployment and signed-in delivery/read-back still blocked: no deployer/GitHub worker credential or real Internet Identity session available. External Supabase browser status is unmanaged; no authenticated production flow was verified. Upgrade messaging_domain, notification_queue, club_domain, earlier competition_domain changes, and deploy the frontend/worker before live checks. No deployment occurred.
