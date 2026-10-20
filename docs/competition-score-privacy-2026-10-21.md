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
