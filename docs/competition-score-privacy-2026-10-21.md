# Competition score privacy — partial implementation

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
