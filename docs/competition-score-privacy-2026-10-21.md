# Competition score privacy — partial implementation

## Current owner decision and rebuild status (20 October, 23:27 UTC)

The owner rejected destructive History cleanup and global PlayHQ screen loss; preserve existing/future data and mask only protected scores in both modes. **Do not apply `20261103000000_competition_score_privacy.sql`: its destructive section is superseded in intent but remains in that staged file.** No migration was applied or deployed.

Implemented this round:
- Team History and Club Recent Games share a dual-mode repository and nullable results; masked scores are not presented as zero-score draws. Summary retains match/MVP information and suppresses protected scoring/export.
- ICP events reads now refresh the original human's club access and consult the configured competition service for recorded competition-event operations. Stored GameResult schema/JSON remains unchanged; managers retain full detail, masked readers retain allowlisted player identity/time/position/discipline and MVP data, but not scores/quarter totals/scoring fields.
- Added trusted-events-only competition score access; unauthorized service calls and mismatched result team writes fail closed. Existing unlinked/ambiguous competition-wide events do not guess division-show overrides.
- Added protected game-player-stat reads and authorized History deletion. Calendar/report conversions preserve nullable scores rather than coercing null to zero.
- Draft non-destructive SQL replacement is in `docs/competition-history-privacy-rebuild.sql`, outside managed migrations. It proposes restrictive History/cache policies, bounded original-human History DTOs, preserved JSON/MVP rows, and score-only fan-out. It is a design draft, not standalone executable rollout SQL and not semantically verified.

Verification:
- Affected frontend suites: Supabase 53 passed / 8 mode-specific skipped; ICP 39 passed / 22 mode-specific skipped. New repository/policy-value checks pass in both modes.
- Motoko History masking test passes, both domain contracts compile, and 17-contract Candid drift passes.
- Real two-production-actor PocketIC rehearsal passes manager/member/outsider reads, detailed-data retention, masked JSON/MVP, original-human service denial, visible score restoration, mismatched team refusal and unavailable-authority refusal. No full-suite rerun or authenticated production UI flow.

Still open (not release-ready):
- Integrate replacement SQL with the initial privacy migration through the managed migration workflow, removing deletion/write-rejection/global-revoke sections **before** any application; validate against actual schema/policies/triggers. Read-only live schema inspection this round confirmed connected DB still has legacy fixture scores and no result table; no writes were made.
- Supabase calendar/result/report/save surfaces need the protected History DTO/atomic write path; the existing save hook still deliberately rejects competition History writes pending that path.
- ICP needs a verified durable match-level association for every materialized fixture and PlayHQ import, not only existing competition-wide operation records, plus upgrade/transfer coverage. No claim of complete competition fixture History synchronization.
- PlayHQ ICP player statistics remain an existing unsupported panel; on-chain stats import/storage/claims and frontend routing still need implementation. Supabase draft policies retain unaffected cache data and manager reads, but affected cached grade aggregates need reconstruction from authorized matches rather than withholding the whole grade.
- Off-event/unlinked saved-game paging, role/privacy query-cache invalidation, raw pitch/summary scoring bypasses and full end-to-end checks remain part of the rebuild.

No user acceptance of history deletion or globally disabled PlayHQ data is implied by prior notes below.

## Implemented
- ICP: separate stable privacy settings, introduced by a new migration ordered after the existing chain; stored match types remain unchanged.
- Manager-authorized setting writes using the competition settings manager check, live access refresh, and transfer fence.
- Competition default and division inherit/hide/show policy.
- Nullable score read DTOs for participant fixtures and anonymous public competition pages; raw stored match results remain available only through existing authorized writes/operator exports.
- Regenerated both frontend Candid binding trees; drift check passed (17 active contracts).
- ICP competition/division controls in CompetitionSettingsPage; fixture/public rendering labels masked completed results “Scores hidden”; client-side ladder calculations skip masked results.
- Reviewed events_domain PlayHQ import: it imports fixture metadata only, returns counts, and does not write competition scores; manual import already requires club/team management authorization.

## Verification
- Pinned Motoko 1.16.1 canister check passed (existing warnings).
- Motoko scorePrivacy.test.mo passed: competition default, division override, inheritance, manager-visible versus masked scores. These are pure policy tests, not authenticated actor integration tests.
- Existing frontend PublicCompetitionPage.ladder.test.ts and CompetitionFixturesPanel.results.test.tsx passed:
  - ICP: 13 passed, 7 skipped.
  - Supabase: 17 passed, 3 skipped.
- No deployment or database application performed.

## Unfinished — not production-ready for both modes
- Supabase database migration, raw-score protection, generated types, and Supabase controls are not implemented. Supabase score privacy remains unavailable; its controls are intentionally not shown.
- Dedicated frontend privacy role/override/ladder tests and authenticated canister integration tests remain outstanding.
- Ladder UI needs explicit “Scores hidden” messaging rather than merely omitting masked results.
- Privacy settings must be included in the operator club snapshot transfer/export/import/purge contract before cross-group transfers are enabled for competitions using this setting.
- No local PostgreSQL policy or schema validation was performed.

## Follow-up implementation (not yet production-ready)
- Added unapplied Supabase migration `20261103000000_competition_score_privacy.sql`: competition/division privacy columns, isolated results with visibility/manager RLS, backfill, permanently-null legacy score constraint, and revoked legacy aggregate view access. Fixture/public reads join protected results; result updates write the new table; ladders derive from visible results. Supabase settings controls are enabled.
- Added explicit ladder privacy messaging (currently generic in the authenticated ladder, rather than conditional on actual masking).
- ICP operator snapshot now exports optional `score_privacy`, validates competition ownership on import, restores settings on replacement, and removes settings on purge. Missing optional field imports as empty settings for older snapshots. Snapshot compatibility/round-trip tests remain outstanding.
- Motoko 1.16.1 `--check` and pure `scorePrivacy.test.mo` passed (existing warnings); Candid drift passed for 17 active contracts.
- Relevant recorded frontend suites (`CompetitionFixturesPanel.results`, `PublicCompetitionPage.ladder`, `matchWorkflows`) passed: Supabase 29 passed / 3 skipped; ICP 25 passed / 7 skipped. Mutation regression mocks were updated for separate result storage.
- No competition_domain replica/PocketIC actor integration harness was found; no authenticated actor integration test was added.

### Remaining release blockers
- Dedicated frontend role/default/inherit/hide/show privacy tests and snapshot transfer compatibility tests are still missing; existing regression tests do not substitute for these.
- Migration has not been applied or validated against local PostgreSQL. Confirm existing score-trigger dependencies during backfill/nulling, legacy aggregate grants, and manager-role equivalence before application. Audit all database functions/views and external sync writers for raw/derived result disclosure. Legacy score writes intentionally fail the new constraint, so external writers must migrate before release.
- Result and metadata writes are separate requests, not an atomic result/status transaction; add an authorized atomic RPC if required for consistency.
- Supabase public ladder currently uses default 3/1/0 points; preserve configured competition scoring before release.
- No deployment, live network calls, or SQL application was performed.

## Round 3 status (2026-10-21)
- Done: Supabase atomic result save RPC `save_competition_match_result` (manager-checked, result + status in one transaction) appended to the unapplied migration; frontend now calls it. ICP result + status already save in one canister call. Supabase public ladder uses configured scoring; ladder "Scores hidden" note shows only when results are masked. Relevant tests pass in both modes.
- Still open: dedicated role/inherit/hide/show frontend tests; snapshot round-trip Motoko test; actor-level PocketIC test (PocketIC binary not present in this workspace); migration still unapplied and unvalidated against a real database.

## Round 4 status

Partial completion; **not release-ready**.

### Changes and verification
- Added signed-in ladder regression cases for null and Candid-empty masked scores with custom 7/4/2 competition points, visible division-show member rendering, and public ladder masking with custom points. Recorded targeted `CompetitionFixturesPanel.results` and `PublicCompetitionPage.ladder` runs passed: ICP **21 passed / 7 skipped**; Supabase **25 passed / 3 skipped**. Skips are mode-specific mutation cases. Logs were written under `/tmp/privacy-icp-final` and `/tmp/privacy-supabase-final`. An initial invocation used incorrect frontend-prefixed test paths and found no files; corrected runs passed.
- Extracted the existing operator snapshot type into `backend/competition_domain/src/clubSnapshot.mo`, used by the production actor and new Motoko test. No wire shape or stable state change. Added a Candid round-trip test preserving both competition hide and division show, plus an actual older record omitting `score_privacy`, which decodes as null and defaults to visible.
- Installed PocketIC **15.0.0** successfully through `npx -y ic-mops@3.5.1 toolchain use pocket-ic 15.0.0`; pinned it in competition_domain/mops.toml. Binary is available at the expected cache path. The snapshot wire test passed on PocketIC (1 test); the subsequent filtered privacy run passed both pure policy and replica snapshot tests (2 tests total), using Motoko 1.16.1.
- Attempted a real competition actor import/instantiation test with `--enhanced-migration src/backend/migrations`: compilation failed with M0257 on the imported actor's migration-initialized fields. Passing that flag through mops test did not make imported actor-class fields eligible. Replaced this failing experiment with the passing shared-contract wire test; it does **not** establish operator export/import/purge behavior or authenticated read authorization. A separately compiled/migration-initialized Wasm harness remains necessary; PocketIC availability is no longer the blocker.

### SQL and writer audit (limited to this checkout)
- Searched all available earlier migrations for score columns and competition match/ladder dependencies. Earlier fixture-event authorization functions (`can_view_competition_fixture_event`, `get_my_viewable_competition_match_ids`) read identifiers/roles, not scores; no changes needed. The vault manager helper permits competition_admin/admin/owner or organizer club_admin. Whether this matches every deployed fixture-writer policy cannot be proven here.
- Reviewed current frontend fixture/public reads joining protected results, signed-in/public ladders deriving from visible results, and the atomic result-save path. PlayHQTeamLinkCard reads fixture identifiers, not score columns. Available Supabase functions contain no competition score writer; the external PlayHQ sync implementation and original competition table/view/trigger creation migrations are **absent** from this checkout. events_domain's PlayHQ importer imports metadata only; its separate game-result storage is not competition_matches.
- No SQL migration changes made: without the missing schema/trigger/sync definitions, claiming compatibility or inventing replacements would be unsafe. Existing legacy-write constraint still requires external sync writers to migrate before release. Audit is incomplete, not evidence that no deployed dependencies exist.
- Obtained PostgreSQL 17.9 tooling through nix; honored the no-SQL-application restriction and did not create/apply schema stubs or connect to any database. Instead parsed the entire privacy migration with PostgreSQL-derived `pglast`: **20 statements parsed successfully**. This checks SQL grammar, not PL/pgSQL bodies, dependency resolution, grants, RLS, trigger effects, or runtime behavior.

### Still not done
- True role/default/inherit/hide/show frontend integration tests: current member tests consume already-masked DTOs, and existing parameterized hiding labels do not exercise actual backend policy selection; anonymous public page rendering and settings override interaction still need dedicated integration coverage.
- Authenticated actor-level hidden-score reads and real operator export/import/purge round-trip remain unverified; the new wire test is explicitly not a substitute.
- Complete deployed-schema/trigger/view/RPC/PlayHQ compatibility audit, fixes where needed, and SQL semantic/RLS validation remain blocked by missing source definitions and the prohibition on applying SQL to any database.
- No full frontend suite, frontend build/typecheck, production actor compilation after type extraction, or Candid drift check was run this round. No deployment, live service calls, or database application occurred; network access was limited to development tooling/guidance downloads.

## Round 5 status

- PocketIC tests against a freshly built production competition_domain Wasm pass: manager reads hidden scores; member and anonymous callers get them stripped across competition hide + division inherit/hide/show.
- Two-canister operator snapshot export -> import -> purge test passes; score_privacy carries over and the source is cleared.
- Candid drift check passes.
- Frontend score-privacy integration tests added (real policy path, both modes); stale ladder tests fixed.
- Full suites: ICP 5,623 passed / 0 failed / 757 skipped; Supabase 6,021 passed / 1 failed (backup test, unrelated to score privacy) / 358 skipped. Affected files not separately rerun after the final fix.
- Still open: Supabase migration audit blocked on missing original competition schema/trigger/view migrations and the external PlayHQ score sync source; migration remains unapplied. Unrelated Supabase backup test failure not investigated.

## Round 6 — production snapshot audit and local rehearsal

**Safe to apply: NO, pending the missing production baseline and owner acceptance.** No live service calls, deployment, or real database writes were performed.

### Dependencies and compatibility
- Read-only production snapshot: `/tmp/cross-project/ignite-club-hq-prod-07e3017afabc4c96a9ebf9d29146ffa6`.
- Production migration `20261018225446` already creates `competition_match_results` keyed by `match_id`, nullable integer scores, `entered_by`, and creation/update timestamps, with an updated-at trigger. The current privacy migration uses `CREATE TABLE IF NOT EXISTS` and additive columns, retaining rows, key, FK and timestamp trigger; it replaces all existing policies because permissive policies combine with OR. Existing result rows win over legacy backfill.
- Audited the subsequent production score migrations `20261018225536`, `20261018230008`, `20261018230633`, `20261018230750`, `20261018231828`, `20261018232044`, `20261018232219`: dependencies include ladder view, `match_scores_hidden`, result-to-event/history fan-out, division/competition toggle re-sync triggers, and external-fixture edit guard. Current migration replaces the fan-out function with a no-op, rewrites match/event sync without scores, and replaces the ladder with a caller-RLS view. Toggle triggers can still update result timestamps but cannot republish scores.
- Production `playhq-sync/index.ts` writes fixture metadata, then upserts `{match_id, home_score, away_score}` into the existing results table on `match_id`, skipping manually overridden fixtures; service-role access is retained. Local service-role upserts using that shape succeeded. This is not an end-to-end execution of the external sync.
- Legacy fixture score columns are restored as null-only compatibility slots; BEFORE/AFTER triggers move authorized non-null legacy scores into protected results without leaking them through fixture RETURNING. Local legacy service-role writes succeeded. Null/null legacy writes do not clear a result; clearing uses the result API.
- Other dependencies: fixture SELECT/write RLS; `can_manage_competition_vault`, `is_competition_admin`, auth identity; competition scoring points and hide-ladder settings; entries/divisions/team joins; broad `events`/`game_results` readers; `playhq_fixtures`, `playhq_ladder`, `playhq_player_stats` raw cache grants. Full production role equivalence and baseline-trigger behavior remain unproven.

### Changes and hook verification
- Reproduced exactly nine failing Supabase `useSaveGameResult` tests; ICP hook cases passed. The event guard was incorrectly sharing the game-results lookup mock, adding false history operations and feeding history errors into event authorization. Separated table-specific mocks without relaxing existing operation assertions.
- Fixed a real bug: guard/transport failures previously rejected the save promise instead of returning false with a destructive toast (silent mode honored); all failures release the in-flight flag for retry. Missing/inaccessible events now fail closed too.
- Added competition-event, permission and transport-failure regression cases asserting no history writes and a successful subsequent retry.
- Recorded competition/score suites plus save hook passed in both modes (`/tmp/r6-final`, summaries and full logs). Final missing-event guard adjustment was separately rerun with `test:recorded` in both modes (`/tmp/r6-guard-final`). No tests were weakened or skipped to hide failures.

### SQL verification and hard blocker
- Used only local PostgreSQL 17.9 on a Unix socket in `/tmp/score-pg`, with anon/authenticated/service_role roles, stub auth schema and `auth.uid()`.
- Attempted **every production migration in filename order, followed by ours**, in fresh database `round6_replay`: it stops in the FIRST production migration (`20260108055928`, line 32), because `public.teams` does not exist. The snapshot migration chain assumes an earlier schema not included in the snapshot; no production schema dump/baseline was found. This is not a failure of the privacy migration, but prevents the requested full-chain clean-apply confirmation. Evidence: `/tmp/r6-replay.sql`, `/tmp/r6-replay.log`. Do not invent baseline objects and call that a complete replay.
- Separately replayed the eight production score migrations listed above, then ours, against explicitly simplified prerequisite tables and role helpers in disposable `round6_policy`; all applied cleanly. Assertions verified manager reads and atomic writes, member/anonymous hidden-score denial, member result/RPC write denial, division show/hide override, legacy redirection, event score scrubbing, history write rejection, and empty pending handoff table (`/tmp/r6-policy.log`, `/tmp/r6-check.log`). This does NOT establish full production-schema compatibility.
- Repeated with explicit cache-table stand-ins in `round6_cache`: anon/authenticated lack SELECT on all three caches, service_role retains writes; cache insert and PlayHQ-shaped result upsert succeeded. These validate privilege statements, not real cache schema dependencies.

### Retired approach — do not apply
- Competition-linked event final scores are permanently null; existing competition `game_results` history rows are deleted (including attached quarter/player/MVP details), and new history writes are rejected. This applies even to visible competitions and managers: use competition fixtures/results, not team History, for scores. Showing scores again does not reconstruct deleted history.
- All browser access to the three raw PlayHQ caches is revoked globally, including visible/unmatched competitions and managers; service sync can continue writing. Cache-backed ladders/player-stat screens need redesign if the owner requires continued access. Previously downloaded/offline data cannot be recalled.
- Legacy division false becomes inherit (preserving the previous competition-hide-wins behavior); new explicit show overrides competition hide. Owner must approve these semantics.
- The owner rejected this destructive approach and chose preservation. The old SQL and initial rebuild SQL are now explicitly retired outside the managed migrations directory.

## Preservation implementation — 21 October completion pass

- Calendar, result editing, History and player reports now use protected dual-mode readers. Stored period/player/MVP data is retained; masked score totals are nullable, not false draws/zero-goal totals.
- ICP exact event/match/team links survive rescheduling and snapshots. Original-human manager checks protect saves; canonical match writes/reads keep linked History and ladders consistent. PlayHQ imported metadata/statistics survive snapshots, obey division/default privacy, and use tenant-scoped player/game keys. Non-exclusive self-identification grants no ownership and only the caller's links are returned.
- Supabase replacement is saved in four **drafts**, assembled in this order: `competition-history-preservation-foundation.sql`, `competition-history-preservation-layer.sql`, `competition-history-report-layer.sql`, `competition-history-preservation-tail.sql`. The former destructive migration was not applied and has been removed from automatic migration discovery.
- The replacement preserves History associations across fixture deletion, authorizes restricted-event reads, retains manager access, protects raw score-bearing cache/board JSON, and reconstructs the canonical ladder from visible results. PlayHQ-shaped upserts bind score handoff to the existing external fixture ID.

### Verified evidence
- Full frontend suites before the final canonical-score additions: **Supabase 6,035 passed / 358 skipped; ICP 5,633 passed / 760 skipped; no failures**. Subsequent targeted History/report tests passed in both modes.
- Production actor PocketIC checks: manager/member/anonymous privacy overrides, exact-link idempotent rescheduling, detailed History/MVP masking, trusted-caller and forged-team denial, snapshot export/import/purge, older snapshot compatibility, PlayHQ member/manager statistics, nonexclusive caller-only claims, canonical score writes and hidden/forged reads all pass.
- Touched canisters compile; all **17** Candid contracts match. Feed parser and History mask Motoko tests pass.
- Disposable PostgreSQL rehearsal applies the full replacement against explicit simplified prerequisite tables, and passes manager scores, hidden member DTOs, raw-table denial, player/MVP preservation and fixture-deletion/archive retention. This is **not** a full production-baseline replay.
- Public preview opens `/auth` with zero browser page errors; signed-in end-to-end checks are unavailable for external unmanaged Supabase. No live database application, deployment, fuel spending, scaling activation or photo-store changes occurred.

### Still not release-complete
- Superseded by the focused live release on 21 October: actual live columns/FKs and authorization helpers inspected; exact-column local rehearsal passed manager/member/outsider, canonical save, goals/assists privacy and archived-report retention. Managed migrations `20261021003048` and `20261021003143` are applied. Live: 69 fixtures, 10 protected results, 66 History rows, no raw fixture/event scores. Internal function execution is denied to anon/authenticated; protected read/save RPCs are signed-in-only. Existing unrelated security findings remain; intentional authenticated definer RPCs validate callers inside, and public helpers return authorization booleans only.
- ICP grade/stat feeds now follow bounded cursor pages (10 pages, 200 fixtures, 2,000 stats), refusing missing/repeated/unsafe cursors and oversized partial imports. Parser tests and production compile pass; actual configured upstream acceptance remains unverified, including whether real cursors use the accepted unreserved URL alphabet.
- Mainnet upgrade: existing deployment workflow now offers default `history` scope, explicitly upgrades only competition/events with `--mode upgrade --no-create`, requires existing identity/key attestation, skips fuel conversion and broad wiring. Cannot launch GitHub Actions from this workspace (no credentials); user must run it. Publish the compatible frontend and verify signed-in History/calendar/result/report flows; external unmanaged Supabase prevents session injection here. PlayHQ sync/acceptance remains explicitly deferred, not a release blocker for History.
