# Supabase replacement review — 25 October 2026

## Verdict

**Not yet safe to claim drop-in production parity.** Most retained functionality is represented, but this fresh source comparison found concrete regressions and deliberate purchase/provider restrictions beyond the retired drills and training pitch mode. No application code, database, deployment or production repository was changed during this review.

### Approved code repair — 25 October, 07:18 UTC

The subsequent approved repair fixes competition-wide Supabase Schedule visibility (including explicit-filter isolation), all three native Drive callback sites through one helper, class-calendar capacity/fullness/duration/age details and full-class waitlist actions, and production goalkeeper appointment counts in display/HTML/CSV. ICP goalkeeper behavior is unchanged. Google login now has an explicit default-off production build setting, `IGNITE_LIVE_GOOGLE_SIGN_IN_ENABLED=true`, to enable only after the retained production provider/callbacks are verified.

Fresh repair verification: **12 focused files / 89 tests pass in each backend mode**, including mocked member Schedule rendering and calendar waitlist submission; ICP isolation guard and preview compilation pass. No authenticated live Supabase or native OAuth flow was verified. No secrets were added or requested, no SQL/services deployed, no repository transfer performed, and no paid catalog safety check bypassed. The earlier table is the original audit finding, not the post-fix status.

## Exact comparison

- Current hybrid revision: `1934796440e299080c34ddb2eb7f841fd2328998`.
- GitHub API independently verified `Ignite-Club-HQ/ignite-club_hq-prod` **main** at `96642d0750e03d933b68957d61999de3ae983b9c`, dated 21 October 2026, 06:47:37 UTC.
- The read-only Lovable production checkout matched that main revision (2,815 files).
- Four independent source reviews covered chats/media/Vault, events/competitions, membership/admin, and payments/external services. Supabase branches were evaluated separately from ICP branches.
- Only drills and training pitch/playback tools were excluded. Training events, recurring schedules, defaults/RSVP and match/game pitch boards remain within scope and are present.

## Remaining user-facing differences

| Item | Evidence in current `frontend/src/` | Production comparison / impact |
| --- | --- | --- |
| Competition-wide Schedule visibility | `pages/EventsPage.tsx:896–908`; `features/events/scheduleReadRepository.ts:2–9` | Prod `src/pages/EventsPage.tsx:562–564` retains RLS-readable `competition_id` events. Current projection omits that field and the client rejects non-team host-club events when the viewer belongs only to an entered team's club. Restore the competition exception without weakening explicit filters or permissions. |
| Native Android Google Drive connection | `components/vault/GoogleDriveImportDialog.tsx:80`, `components/vault/LinkDriveFolderDialog.tsx:90`, `features/vault/useVaultDriveLinkWorkflow.ts:125` | Native authorization/exchange uses `https://reference.invalid`, whereas prod uses `https://igniteclubhq.app/vault`. New Drive imports/folder connections cannot complete through the production callback. Browser callbacks still use the current origin. Existing linked-folder operations were not proven broken. |
| Class calendar information | `pages/ClassEnrolmentPage.tsx:880–925` | Prod `src/pages/ClassEnrolmentPage.tsx:530–558` shows capacity/fullness, duration and age/level. Those details remain in current list view but are absent from calendar cards; new calendar enrolment actions do not restore the missing information. |
| New paid club/team upgrades blocked | `pages/ClubUpgradePage.tsx:610–614,680–684`; `pages/UpgradeProPage.tsx:460,519–523`; `hooks/useInAppPurchase.ts:77`; `lib/subscriptionPlans.ts:70–73` | Every new v2 product is checked against an empty readiness list, stopping web/native purchases. This is an intentional safety gate, not a reason to bypass it. Production purchases formerly proceeded. Complete catalog and verified entity-scoped fulfillment before enabling new purchases. |
| Google login hidden | `lib/authProviderFlags.ts:10` | Prod AuthPage offers Google; current flag is false. Previously deferred provider setup is not automatically replacement-equivalent. Hosted provider settings were not checked; enable only after confirming the target backend/provider configuration. |
| Goalkeeper report metric changed | `components/reports/PlayerStatsReportView.tsx:711–712`; `components/reports/playerStatsReportExtras.ts:342–364` | Prod `src/components/reports/PlayerStatsReportView.tsx:754` uses `Math.max(gkMatches, gkAppointed)`; current uses recorded appearances only. Appointed keepers without recorded position stats lose the former count, including exports. Treat as an unresolved parity difference, not an approved redefinition. |

## Backend and release compatibility

The intended eventual replacement should retain the existing production Supabase backend and records. A code checkout does not import those records or confirm deployed services.

- History and reports now require `read_game_history` and `read_history_player_stats`. Current definitions/grants exist, but their deployment on the eventual production target was not checked. Do not replace protected reads with raw-table fallbacks to hide missing migrations.
- Current repository lacks production's original migration baseline and most production HTTP-function implementations/configuration: production has 1,135 migration files versus 41 current files with no shared filenames; function-directory entries are 121 versus 4 (including `_shared`). These are **source inventory differences**, not counts of missing live services. Current migrations are incremental, not a proven clean-install schema.
- Existing production Stripe checkout source creates AUD prices; current catalog supplies USD/v2 identifiers. Reusing the old function without catalog/receipt/fulfillment reconciliation does not close payment parity. Existing subscriptions must remain intact.
- Retaining production requires checking schema/RLS/grants, required RPCs, function versions/auth rules, buckets/policies, realtime, auth callbacks/hooks and scheduled workers. Push/Resend delivery, Google Drive OAuth, store products/receipts and native signing/capabilities require independent release acceptance.
- Native iOS source layouts differ; that alone does not prove the current Codemagic pipeline cannot generate the platform. Web publication does not certify a native release.
- No live backend settings, data, secrets or production endpoints were changed or private production database records read.

## Areas retained by source inspection

No additional confirmed removal was found in the reviewed Supabase paths for the seven chat families; replies/reactions/forwarding/search/attachments/scheduling/presence; poll multiple-choice/closing/voter details; gallery/comments/moderation; Vault folders/trash/backups/export; club/team membership and roles; children/invites/EOI/seasons; fixtures/PlayHQ; events/RSVP/duties/reminders; game pitch boards; Home/news/themes/rewards/sponsors; or ordinary administration.

This is not exhaustive behavioral certification. Removed modules may have extracted replacements: for example, poll voter viewing uses a drawer instead of the old dialog. No non-deprecated existing route removal was found. Ads are disabled in both versions, not a new loss. Strict ICP request blocking exits for correctly selected Supabase email sessions and does not, by inspection and focused tests, disable normal Supabase transport.

## Verification and limits

Fresh Supabase-mode run: **7 test files, 394 passed, 0 failed, 0 skipped**:

- `features/productionParityPolicyMatrix.test.ts`
- `live/strictIcpTransport.test.ts`
- `lib/subscriptionPlans.test.ts`
- `features/events/scheduleReadRepository.test.ts`
- `features/competitions/history/historyRepository.test.ts`
- `features/competitions/history/reportRepository.test.ts`
- `components/reports/playerStatsReportExtras.test.ts`

These existing tests pass despite the identified gaps: they do not cover every rendered Schedule/class/Drive flow or provider fulfillment. Earlier complete suite results are historical and were not rerun here. Preview build report is OK; no app edits were made. No authenticated member/admin flow, real charge, email, push, Drive callback or native store operation was exercised.

## Replacement acceptance checklist

- [x] Repair competition-wide Schedule visibility with policy and rendered-member regression checks for an entered-team member outside the host club.
- [x] Restore the registered native Drive callback consistently across authorization and code exchange; real provider/device acceptance remains below.
- [x] Restore class-calendar information while retaining current enrolment actions and full-class waitlist behavior.
- [x] Restore production goalkeeper-count parity in Supabase report display and both exports, without altering ICP's recorded-appearance metric.
- [ ] Reconcile provider catalog/fulfillment and approve paid purchase activation; preserve existing subscriptions.
- [ ] Verify production Google provider/callbacks before restoring its login button.
- [ ] Verify incremental SQL and deployed service compatibility on the retained production backend, without resetting data or replacing unknown existing setup.
- [ ] Run signed-in member/admin acceptance and native/provider staging checks before cutover.

No code transfer, merge, automation activation or backend cutover was performed. As instructed, secret-dependent production verification waits until this code is moved into the other repository. Moving code does not itself certify SQL migration application, USD/v2 provider catalog readiness or verified fulfillment; paid activation remains blocked until those checks pass. Existing backend data/services/secrets must be retained.