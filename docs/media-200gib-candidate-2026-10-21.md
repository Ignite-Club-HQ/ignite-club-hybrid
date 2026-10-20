# Photo store 200 GiB candidate (21 Oct 2026)

Standard Motoko 1.16.1, no custom runtime.

## Limits
- App ceiling: 200 GiB (`uploadPolicy.largeCapacityCeiling`); new-club admission still stops at 80% (171,798,691,840 bytes).
- Build cap: `--max-stable-pages 3932160` (240 GiB) in `backend/media_blob_store/mops.toml`, photo store only.
- Runtime ceiling: 256 GiB shared Region block table. Unsafe to approach; no exhaustion guard.
- Files: 1,000,000 finalized+pending records per store (was 100,000).
- Extra Regions (banks 1–3) are production storage in large mode; the rehearsal flag is no longer required.
- Enlarge workflow accepts 3–200 GiB.

## Local evidence
- All 13 media Motoko tests pass; production build passes with the new page cap.
- Real upgrade from the saved 64 GiB module: capacity unchanged until enlarged, 200 GiB persists through a second upgrade, committed/pending bytes and exact totals preserved, unauthorized/above-ceiling rejected.
- Multi-Region sparse boundary (64/128/192 GiB), real-actor bank rollover with production writes after the rehearsal flag is removed, prior-actor upgrade, Pro allowance and storage replica tests pass.
- Long large-store workload not re-run to completion (exceeds sandbox time).

Not a full-volume fill or live acceptance.

## Release
1. Deploy the new photo store module through the normal mainnet workflow.
2. Run **Test larger photo store (isolated mainnet)** with scenario **smoke200**: unique id e.g. `media-200-smoke-001`, budget **3** (maximum upfront funding including fee, not expected spend), confirmation **TEST ISOLATED STORE**. It creates one separate store, sets the 200 GiB ceiling, uploads only a few MiB, verifies read/delete/abort, an unauthorized delete refusal and a memory-preserving upgrade, and checks the 200 GiB setting survived. It never fills the store and never touches a group.
3. Run `Enlarge Group 1 photo store` with size 200.
