# Larger photo store — Stage 1, 20 October 2026

Both isolated local scenarios completed. Nothing changed live.
Wasm SHA-256: `8ea0289f54fb5224c1eb1e17da9242e909d34dd333cfb5f7643bbfaaebf76c9b`.

| Scenario | Ceiling | Files | Payload bytes | Allocator high-water bytes | Payload / ceiling |
|---|---:|---:|---:|---:|---:|
| Mixed 400 KiB–8 MiB | 5 GiB | 1,417 | 4,294,524,928 | 4,322,230,272 | 79.99% |
| Tiny 1 KiB | 512 MiB | 8,192 | 8,388,608 | 536,870,912 | 1.5625% |

Mixed evidence survives as the completed PASS line in `docs/media-large-store-mixed-2026-10-20.log`. Detailed mixed timing/fuel results were lost when the later tiny-file scenario crashed; unavailable, not estimated. The runner emits PASS after exact totals, two same-size churn rounds, sampled streamed/hash readback and interrupted-upload upgrade checks. This is log-backed evidence, not a recovered full JSON report.

Mixed high-water exceeds payload by 27,705,344 bytes (0.645% of payload). This is NOT total overhead: it excludes heap/runtime and roughly 1 GiB unused below the ceiling. It does not establish 20–25 GiB usable at 32 GiB.

Full tiny-file evidence: `docs/media-large-store-records-2026-10-20.json` and corresponding log. Four concurrent uploads, observed refusal, two churn rounds replacing 4,096 files each, exact totals, 16 sampled streamed/hash reads and a written-but-unfinalized upload surviving an actual upgrade passed. Refusal was physical exhaustion, not the 100,000-record limit.

| Tiny-file measurement | Result |
|---|---:|
| Fill time | 530,314.08 ms (8.84 minutes) |
| Local payload fill rate | 0.01509 MiB/s |
| Upload samples including churn | 16,384 |
| Upload median / p95 | 284.59 / 833.44 ms |
| Read median / p95 | 3.31 / 4.99 ms |
| Heap at fill / after churn and upgrade | 57,090,536 / 66,737,176 bytes |
| Wasm memory at fill and afterwards | 335,544,320 bytes |
| Aggregate simulated cycles | 2,087,350,449,456 |

The stable allocator's 64 KiB minimum slot explains tiny-file waste. This is not current live legacy storage or the paused packed prototype. Local timing/cycles are not mainnet speed/cost or per-operation instructions. Zero runtime stable-memory telemetry does not override Region high-water evidence.

This demonstrates more than 2 GiB payload locally, not full 32 GiB capacity or every club's promised growth. Synthetic assumed sizes, same-size churn and sampled reads do not prove customer workloads, resize fragmentation, encryption/permissions, all-record integrity, full metadata capacity or gallery/chat/vault acceptance. No club-count/sellable-space guarantee follows.

Next requirements: `docs/media-large-store-stage-two.md`.