# Offline lookup kernel load test — 2026-10-20

## Completed follow-up: indexed placement and isolated IC measurements

The original observations below are historical. Selection now uses a disposable
per-target ordered index in `backend/shard_router/src/group_index.rs`, rebuilt
from authoritative stable groups after upgrade. Every production group write
refreshes the index synchronously. Placement rechecks health, target, rollover,
growth reservations, revision and deletion locks; existing assignments remain
immutable and retries consume no extra capacity. Exact rational ranking and
smallest-ID ties match the old selector.

`frontend/scripts/test-router-scale-replica.mjs` passed against actual router
Wasm on isolated PocketIC 14.0.0 at 65, 500 and 4,096 registered groups. All
groups had complete synthetic domain/placement records; these are not installed
feature services. The harness verified respectively 2, 8 and 64 bounded registry
pages, exact counts/no duplicates, stable revision, preserved assignments across
upgrade, unchanged retry counts, foreign-target and revision refusal, anonymous
and non-governor refusal, stale health and exhausted fuel denial.

| Groups | Healthy placement | Retry | Hosted lookup | Cold rebuild + placement | All expired refusal |
|---:|---:|---:|---:|---:|---:|
| 65 | 10,623,726 | 222,529 | 222,510 | 10,660,437 | 12,680,223 |
| 500 | 446,780 | 241,049 | 241,105 | 80,252,957 | 103,761,212 |
| 4,096 | 512,934 | 268,924 | 269,152 | 664,055,035 | 936,632,130 |

Values are measured IC `performance_counter(0)` instructions inside the real
endpoint path, excluding ingress/reply Candid encoding. The first 65-group
placement builds the index. Exhausted-fuel refusal at 4,096 groups measured
30,820 instructions. Full raw evidence: `scaling-router-replica-2026-10-20.json`.
Cold rebuild and all-expired paths remain linear, and explicitly passed under
PocketIC's default production execution configuration. This does not establish
live subnet load, throughput, concurrent-user capacity, or a universal message
headroom percentage. Cross-canister membership batches remain unmeasured here.

The updated native 100,000-placement comparison verifies 100,000 indexed
candidate checks versus 409,600,000 scan checks at 4,096 groups. Native elapsed
totals were 253,478,848 ns indexed versus 11,248,401,362 ns scan; timings are
machine-dependent and are not IC instructions.

Identity tests now pass actual registration of 10,001 accounts and retained
history of 10,001 erased accounts plus 80,001 denials, retaining initial and
terminal records. These are native stable-map regressions, not network account
load tests or a proof of unlimited storage.

Checks: 34 router unit tests, 16 native scale tests, 55 identity tests, 19 frontend
tests in each backend mode; all passed. Default production Wasm compiles,
checked-in router Candid matches, and all 17 active binding contracts pass drift.
`scale-probe` is a non-default isolated instrumentation feature, additionally
governor/environment-gated, absent from production Candid. Never deploy it.

Reproduce:
```sh
cargo test -p shard_router --lib
cargo test -p shard_router --test scale_lookup -- --nocapture
cargo test -p identity_access --lib
cargo build -p shard_router --release --target wasm32-unknown-unknown --features scale-probe
POCKET_IC_BIN=/path/to/pocket-ic SHARD_ROUTER_WASM="$PWD/target/wasm32-unknown-unknown/release/shard_router.wasm" node frontend/scripts/test-router-scale-replica.mjs
# Restore default production build; no probe methods in this module.
cargo build -p shard_router --release --target wasm32-unknown-unknown
```

No mainnet deployment, group opening, club move, funding or live measurement
occurred. The 4,096 registry safety bound and resource/admission limits still
exist: this closes the specified offline gaps, not an unlimited-capacity claim.

## Historical pre-index scope and reproducibility

Run `cargo test --manifest-path backend/shard_router/Cargo.toml --test scale_lookup -- --nocapture`.
The new integration test imports the actual `groups::select` implementation without editing production files. It builds group fixtures and inserts 100,000 immutable-key assignments into a native BTreeMap. It does **not** register groups through the canister API or invoke the three public lookup/placement endpoints. Native timing is not IC instruction accounting.

A concurrent engineer changed `MAX_GROUPS` from 64 to 4,096 during this session; the executed test used **4,096**, plus the explicit **500** group case. No protected source was edited by this task.

## Exact observed numbers

Unoptimized native Rust test, one run; elapsed times are machine-dependent, integer means rounded down:

| Groups | Assignments | Placement total ns | Placement mean ns | Lookup total ns | Lookup mean ns | Selection candidate visits |
|---:|---:|---:|---:|---:|---:|---:|
| 4,096 | 100,000 | 11,404,378,354 | 114,043 | 71,678,689 | 716 | 409,600,000 |
| 500 | 100,000 | 1,502,083,114 | 15,020 | 71,471,529 | 714 | 50,000,000 |

13 tests passed, zero failed (12 imported group tests and one scale test).

**Instructions per call: not measured. PocketIC cycles: not measured. Proximity to a per-message instruction limit: unknown.** This is a partial offline benchmark, not the requested end-to-end IC instruction-limit evidence; no numbers are inferred from native timings. Candid, stable-memory serialization, authentication, revision checks and cross-canister callbacks are excluded. The native lookup uses a different BTreeMap implementation from production stable structures.

## Source review and next measurement

`assign_new_club_group` delegates to `assign_group_record`, which decodes every registered group, filters eligibility, then calls `groups::select`. Selection is O(groups), and full-record decoding precedes it on every new placement. Retries use direct assignment/group lookup. `read_hosted_club_assignment` does keyed assignment and group reads. `read_my_group_assignments` does those reads for every requested club, followed by sequential membership-authority calls and revision checks; endpoint cost and latency cannot be represented by the native single-map lookup timing.

Suggested improvement (not implemented): a per-target eligible-group ordered index keyed by exact utilization ratio and deterministic group-ID tie-break, plus expiry tracking for freshness; atomically update it on assignments, health, budgets and accepting-state changes. Revalidate selected candidates before committing. Avoid cached eligibility surviving health expiry or locks.

For instruction evidence, build the actual router Wasm and membership stub in an isolated PocketIC harness; register complete groups and health, place clubs in separate messages, then measure placement/retry/hosted lookup and bounded membership batches with IC performance-counter instrumentation in a test-only wrapper or PocketIC cycle deltas (cycles are not instructions). Cover fresh, expired and exhausted groups, and compare measured message maxima to the configured subnet limits. That harness remains outstanding; no live calls, deployments or cycles were spent here.
