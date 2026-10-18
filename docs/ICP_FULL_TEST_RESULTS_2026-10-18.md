# Full frontend ICP test results - 2026-10-18

## Revision and scope

- Repository: Ignite-Club-HQ/ignite-club-hybrid, branch main.
- Revision: da37ae87 (Hardened deployer grant flow).
- Local main was clean, then fast-forwarded to origin/main by 178 commits before testing.
- Dependencies synchronized through scripts/ensure-frontend-deps.mjs.
- No production code or tests changed during this verification.
- Scope: full frontend Vitest collection in ICP mode. This is not a deployed canister, native-device, browser E2E, or executable Motoko test run.

## Full-run outcome

| Result | Count |
| --- | ---: |
| Passed tests | 4,883 |
| Failed tests | 1 |
| Skipped tests | 735 |
| TODO tests | 2 |
| Total tests | 5,621 |
| Passed files | 604 |
| Failed files | 1 |
| Skipped files | 1 |
| Total files | 606 |

- Exit code: 1.
- Duration: 766.81 seconds (approximately 12 minutes 47 seconds).
- No unhandled-errors section was reported.

## Remaining failure

File: frontend/src/pages/IcpManageBackupsPage.test.tsx, assertion at line 36.

Test: `ICP vault metadata backup administration > restores missing metadata and deletes the selected snapshot`.

Assertion: expected the mocked restore function to be called with `{}` and `backup-1`; observed zero calls.

The test mocks `restoreLiveVaultBackup`, while IcpManageBackupsPage now calls `restoreLiveVaultBackupWithMedia`. The page test has not been updated to mock/assert the new media-aware restore API. This indicates a test harness/API mismatch, not proof of a production restore defect. The selected-snapshot deletion assertion is not reached after the restore assertion fails.

Isolated rerun of this file: 6 passed, 1 failed, 7 total; same failure, exit code 1. No fixes applied.

## Outstanding coverage markers

The coverage register still contains two TODO tests:

- `ICP coverage register > ICP path: Backup administration`.
- `ICP coverage register > ICP path: Account deletion`.

TODOs and skipped tests are not positive functionality verification. Current source policy classifies payments, passwords and AdMob as off-chain exceptions; that classification was not changed or independently approved by this test run.

## Previously failing areas

- EventsPage.icp-roster.test.tsx: all 3 tests pass, including ordinary-member public fixture visibility.
- WelcomeEmailSettingsCard.test.tsx: 3 pass, 2 provider-specific skips; competition settings parity now passes. This does not establish actual welcome-email delivery.
- icpFeatureParityGaps.test.ts: all 22 sentinels pass. These check source markers, not complete user workflows.

## Reproduction and artifacts

Run from the repository root:

```sh
npm --prefix frontend run test:recorded -- --backend-mode=icp --output-dir="$PWD/frontend/.test-results/icp-full-da37ae87-20261018" --reporter=dot --reporter=json --outputFile.json="$PWD/frontend/.test-results/icp-full-da37ae87-20261018/vitest.json" --silent
```

Saved local full-run artifacts (ignored by Git):

- frontend/.test-results/icp-full-da37ae87-20261018/icp.log
- frontend/.test-results/icp-full-da37ae87-20261018/summary.json
- frontend/.test-results/icp-full-da37ae87-20261018/vitest.json

The isolated backup rerun has corresponding artifacts under frontend/.test-results/icp-backups-recheck-da37ae87-20261018/.