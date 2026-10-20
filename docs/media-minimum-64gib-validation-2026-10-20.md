# Minimum 64 GiB storage assessment

## Result

Local targeted checks passed using Motoko 1.16.1, core 2.6.1 and PocketIC 15.0.0. Production code, capacity ceilings, group settings and live canisters were not changed. No paid test was started.

## Evidence

- `backend/media_blob_store/test/stableBytes64Boundary.test.mo`: real Region-backed allocator sparsely grows past 32 GiB and to 64 GiB minus 64 MiB. Exact ciphertext readback, deletion/reuse, held reservation, bounded-cap refusal without mutation, and out-of-bounds slice rejection pass. Only small payloads are written; this is high-address coverage, not a fill test. The 64 MiB margin is a test choice, not a measured production overhead guarantee.
- All 10 existing media Motoko test files pass, including exact 80% admission boundaries, finalized plus pending allowance accounting, 5 GiB Pro allowance plus add-ons, fragmentation and competing reservations. New boundary fixture also passes.
- `frontend/scripts/test-media-minimum-capacity-replica.mjs`: real current actor accepts 32 GiB only after stable-write activation, rejects 64 GiB, rejects unauthorized setting changes, preserves committed bytes/settings and a partially uploaded 1,000,008-byte file through a memory-preserving upgrade. Completion, delete, abort/retry, exact totals and reuse of the 2,097,152-byte high-water allocation pass.
- Existing `test-media-pro-allowance-replica.mjs`: real club/store services count gallery, vault and chat finalized and pending bytes together; abort releases accounting. Pass.
- Both current media and club canisters compile successfully. Existing compiler warnings remain; no compiler errors.

## Reproduce

From `backend/media_blob_store`: `mops test --reporter files`, `mops check`, `mops build`.
From `backend/club_domain`: `mops install`, `mops check`, `mops build`.
From project root:

```sh
node frontend/scripts/test-media-minimum-capacity-replica.mjs
POCKET_IC_BIN=/root/.cache/mops/pocket-ic/15.0.0/pocket-ic node frontend/scripts/test-media-pro-allowance-replica.mjs
```

## Remaining distinction

These checks establish allocator high-address behavior and current production regression coverage—not a deployed 64 GiB configuration. `stableBytes.largeLimit`, `uploadPolicy.largeCapacityCeiling`, the actor capacity-setting guard and enlargement policy remain at 32 GiB. No candidate 64 GiB production version was built or tested. A future ceiling change must leave room for runtime/metadata, preserve the existing 80% admission safety margin and rerun the affected exact-boundary/settings tests. Do not market 64 GiB of usable club space from this result.

A small isolated live check of that changed version remains pending the GitHub-held deployment identity and explicit funding/deployment authorization. Neither full-volume paid filling nor another thousands-of-files stress run is necessary for this targeted assessment. Full-store or many-club throughput and guaranteed simultaneous club entitlements remain unmeasured.