# ICP Full-Run Skip Audit — 2026-10-18

## Run identity

- Branch/revision: `main` at `6817d959` (post-merge ICP fixes).
- Command: `npm run test:recorded -- --backend-mode=icp ...` with Vitest `dot` and `json` reporters.
- Collection: 624 files, 5,742 test cases.
- Result: 5,005 passed, 0 failed, 735 skipped, 2 TODO.
- Duration: 769.62 seconds.
- No unhandled errors were reported.

## What the 735 skips mean

The case-level audit matched all 735 skipped cases to an explicit condition that disables the test in ICP mode:

- 461: `runIf(supabaseMode)`.
- 82: `runIf(backendMocks.mode === "supabase")`.
- 64: `runIf(!icpMode)`.
- 46: `runIf(mocks.mode === "supabase")`.
- 27: `runIf(mode === "supabase")`.
- 20: `runIf(backendMode === "supabase")`.
- 9: `runIf(liveMocks.mode === "supabase")`.
- 7: `runIf(!state.icpMode)`.
- 6: `runIf(process.env.IGNITE_TEST_BACKEND_MODE !== "icp")`.
- 5: `runIf(icpMocks.mode === "supabase")`.
- 8: a `supabaseIt = mockIcpMode ? it.skip : it` alias in `messageQueue.test.ts`.

This confirms the skips are deliberate test-run decisions, not accidental unmarked skips. It does **not** prove that every skipped Supabase behavior has a matching positive ICP behavior test, nor that the corresponding product feature has full parity. That requires the coverage register and feature-level ICP tests below.

The two TODO cases are separate from the 735 skips:

- `ICP coverage register > ICP path: Backup administration`.
- `ICP coverage register > ICP path: Account deletion`.

This audit establishes why the test runner skipped cases; it does **not** establish feature parity for the skipped behaviors. Each Supabase-owned behavior still needs a corresponding positive ICP test or an explicitly approved off-chain classification.

## Latest Full-Run Failures

There were no failing tests in the full run on `6817d959`. The backup restore assertion that failed on `da37ae87` passed after the subsequent main updates.

The full-run JSON confirms these previously failing tests pass on `6817d959`:

- `EventsPage.icp-roster.test.tsx`, including ordinary-member public fixture visibility.
- `WelcomeEmailSettingsCard.test.tsx`, including competition settings adapter coverage.
- All 22 `icpFeatureParityGaps.test.ts` sentinels.

## Saved Artifacts

The latest full-run logs and JSON are in the ignored directory `frontend/.test-results/icp-full-6817d959-20261018/`:

- `icp.log`
- `summary.json`
- `vitest.json`

The earlier `da37ae87` run and isolated backup rerun are retained in their correspondingly named result directories as historical diagnostics.