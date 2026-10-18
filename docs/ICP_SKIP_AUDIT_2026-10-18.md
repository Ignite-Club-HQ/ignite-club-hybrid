# ICP Full-Run Skip Audit — 2026-10-18

## Run identity

- Branch/revision: `main` at `da37ae87` (`Hardened deployer grant flow`).
- Command: `npm run test:recorded -- --backend-mode=icp ...` with Vitest `dot` and `json` reporters.
- Collection: 606 files, 5,621 test cases.
- Result: 4,883 passed, 1 failed, 735 skipped, 2 TODO.
- Duration: 766.81 seconds.
- No unhandled errors were reported.

## What the 735 skips mean

The 735 skips are not 735 known product failures. The case-level audit matched them to explicit test controls that disable Supabase-owned tests in ICP mode. Those controls include `runIf(supabaseMode)`, backend-mode variants such as `mode === "supabase"`, a conditional `supabaseIt = mockIcpMode ? it.skip : it` alias, and dynamic `!state.icpMode` gates. The skipped cases are spread across 95 files.

Ten cases were initially missed by the automated matcher, but source inspection confirmed their explicit Supabase gates:

- Eight cases in `vaultExportRepository.test.ts`, under `describe.runIf(liveMocks.mode === "supabase")`.
- The per-member reminder entry-point case in `AttendanceSection.test.tsx`, under `it.runIf(mocks.mode === "supabase")`.
- The Supabase team metadata read case in `useTeamChatTeamData.test.tsx`, under `it.runIf(liveMocks.mode === "supabase")`.

The two TODO cases are separate from the 735 skips:

- `ICP coverage register > ICP path: Backup administration`.
- `ICP coverage register > ICP path: Account deletion`.

This audit establishes why the test runner skipped cases; it does **not** establish feature parity for the skipped behaviors. Each Supabase-owned behavior still needs a corresponding positive ICP test or an explicitly approved off-chain classification.

## Failure

The only failing assertion was:

- File: `frontend/src/pages/IcpManageBackupsPage.test.tsx`.
- Test: `ICP vault metadata backup administration restores missing metadata and deletes the selected snapshot`.
- The test expects `restoreLiveVaultBackup` to be called; the page now calls `restoreLiveVaultBackupWithMedia`.
- Isolated rerun: 6 passed, 1 failed. This is a stale test mock/assertion; it does not prove the production restore flow is broken.

The full-run JSON also confirms these formerly failing tests pass on this revision:

- `EventsPage.icp-roster.test.tsx`, including ordinary-member public fixture visibility.
- `WelcomeEmailSettingsCard.test.tsx`, including competition settings adapter coverage.
- All 22 `icpFeatureParityGaps.test.ts` sentinels.

## Saved artifacts

The full-run logs and JSON are in the ignored directory `frontend/.test-results/icp-full-da37ae87-20261018/`:

- `icp.log`
- `summary.json`
- `vitest.json`

The isolated backup test rerun is in `frontend/.test-results/icp-backups-recheck-da37ae87-20261018/`.