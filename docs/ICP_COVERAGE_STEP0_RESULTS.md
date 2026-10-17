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
