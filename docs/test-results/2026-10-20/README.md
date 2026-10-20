# Frontend Test Results (2026-10-20)

Full Vitest runs using `frontend/vitest.legacy.config.mjs` and the repository's recorded test runner. These are test-run results, not a claim of ICP/Supabase feature parity.

| Backend mode | Passed | Failed | Skipped | Status |
| --- | ---: | ---: | ---: | --- |
| Supabase | 5,583 | 0 | 335 | Passed |
| ICP | 5,165 | 18 | 735 | Failed |

## Artifacts

- ICP: [summary](icp/summary.json), [full Vitest JSON](icp/vitest.json), [console log](icp/icp.log)
- Supabase: [summary](supabase/summary.json), [full Vitest JSON](supabase/vitest.json), [console log](supabase/supabase.log)

The ICP run exits nonzero because 18 tests fail. Those failures are retained behavior-gap tests; production implementation was not changed to make this run green. Skipped counts include tests gated for the other backend mode.

These full-suite reports were generated before the later grouped-routing scope assertions were added to the event workflow and feature-router tests. Those touched suites were rerun in both backend modes and passed; the complete suite was not rerun after those final test-only additions.

## Reproduce

From the repository root:

```sh
npm --prefix frontend run test:recorded -- --backend-mode=icp --output-dir="$PWD/docs/test-results/2026-10-20/icp" --reporter=dot --reporter=json --outputFile.json="$PWD/docs/test-results/2026-10-20/icp/vitest.json" --silent
npm --prefix frontend run test:recorded -- --backend-mode=supabase --output-dir="$PWD/docs/test-results/2026-10-20/supabase" --reporter=dot --reporter=json --outputFile.json="$PWD/docs/test-results/2026-10-20/supabase/vitest.json" --silent
```
