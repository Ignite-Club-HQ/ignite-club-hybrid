# Bounded capacity results — 20 October 2026

No live changes, new allocators, allowance changes or club moves. Full space/mainnet capacity acceptance remains unproven.

Runner: `node frontend/scripts/test-media-realistic-capacity-replica.mjs`. Build first with `mops build media_blob_store` in `backend/media_blob_store`. Report: `/tmp/media-realistic-capacity.json`. Tested Wasm SHA-256: `8ea0289f54fb5224c1eb1e17da9242e909d34dd333cfb5f7643bbfaaebf76c9b`.

Four concurrent requests on existing user-path actor methods use synthetic ciphertext. Mixed sizes repeat 200 KB, 400 KB, 200 KB, 1.1 MB, 2.1 MB and 8 MB—assumptions, not observed customer data. A completely refused batch ends filling; smaller files might still fit.

| Mode | Configured ceiling | Objects | Payload | Allocator high-water | Payload fraction |
|---|---:|---:|---:|---:|---:|
| Legacy mixed | 32 MiB | 19 | 26,700,000 bytes | Not applicable | 79.57% |
| Opt-in stable mixed | 256 MiB | 105 | 204,800,000 bytes (195.31 MiB) | 256 MiB | 76.29% |
| Opt-in stable 1 KiB files | 16 MiB | 256 | 262,144 bytes | 16 MiB | 1.56% |

The existing stable allocator has a 64 KiB minimum slot. Its tiny-file result is not the paused packed prototype or live legacy-store behaviour. A universal payload-only margin cannot protect this mix.

Upload median/p95 milliseconds: legacy 156/1039; stable mixed 278/1184; stable small 97/145. Stream read median/p95: 21/121, 10/103, 3/3. Local fill MiB/s: 8.50, 8.89, 0.032. Aggregate simulated cycles: 164,060,117,748; 1,173,856,461,010; 72,766,968,518. These include fill/churn/reads/upgrade, not mainnet throughput, per-operation instructions or dollar costs.

Stable mixed heap at fill was 25,483,704 bytes; Wasm memory 469,762,048 bytes. Legacy heap was 80,947,952 bytes. Buffers, GC, journals and runtime affect readings; metadata-only overhead is not isolated. Zero `memory_stats.stable_bytes` does not replace Region high-water telemetry.

All scenarios pass exact payload totals, observed refusal, two alternating-object same-size churn rounds, and actual upgrade of a written but unfinalized upload. Stable high-water stays unchanged. Every finalize hash is checked; 16 streamed readbacks per scenario are verified. Interrupted new-test uploads are 200 KB/1 KiB, not large multi-chunk cases.

Existing physical-capacity suite passes four held slots/fifth refusal, lower-limit preservation, abort/reuse and 32 × 400 KB fill. Existing storage suite passes real club membership/two-store quotas, concurrent reservations, migration/streaming, coordinated snapshots, stopped-authority retries, lost client acknowledgement and uncertain-commit upgrade/governor recovery. Run the latter with `POCKET_IC_BIN=/tmp/pocket-ic`.

## Recommendation

Keep custom engineering paused and clubs in place. Do not certify club counts or turn the observed 76% into a payload guarantee. A 50% physical planning ceiling for this mixed workload is a conservative candidate, **not an approved limit or tiny-file guarantee**.

Admission/extra-storage decisions need exact live commitments, pending uploads, mode and allocation overhead plus growth headroom. Do not approve increases when evidence cannot cover existing promises plus the increase and a margin. These tests do not establish that live baseline or margin.

Remaining evidence: observed file-size distribution, larger volumes/resize churn, full 2/32 GiB acceptance, the 100,000-record ceiling, isolated metadata costs, per-operation instructions and real gallery/chat/vault UI acceptance. No live flags, limits, routing or migration are authorized by this report.