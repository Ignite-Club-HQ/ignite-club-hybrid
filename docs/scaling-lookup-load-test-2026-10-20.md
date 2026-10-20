# Offline lookup kernel load test — 2026-10-20

## Scope and reproducibility

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
