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
