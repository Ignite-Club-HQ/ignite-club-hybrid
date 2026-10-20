# Multi-Region photo-store redesign — 20 October 2026

## Outcome

Implemented an additive multi-Region layer with a 500 GiB **virtual address design**, not a 500 GiB physical-capacity release. No mainnet deployment, funding, enlargement, club movement, group opening or customer allowance change occurred.

**Blocking finding:** Motoko 1.16.1 has a shared 32,768-entry Region block table and 8 MiB blocks, giving a **256 GiB aggregate Region storage constraint**. Multiple Regions do not bypass it. The compiler's default `--max-stable-pages 1638400` is a **100 GiB physical soft cap across Regions**, not a separate allowance per Region. Raising it to 500 GiB is unsafe with this runtime. Earlier explanations that a multi-Region conversion alone could deliver 500 GiB were incorrect.

Sources inspected:
- [Pinned runtime region.rs](https://github.com/dfinity/motoko/blob/1.16.1/rts/motoko-rts/src/region.rs): `meta_data::max::BLOCKS`, `PAGES_IN_BLOCK`, `region_grow` and the shared block table. The growth path lacks an explicit aggregate-table exhaustion check before committing new block associations.
- [Pinned compiler](https://github.com/dfinity/motoko/blob/1.16.1/src/exes/moc.ml) and installed compiler `--help`: `--max-stable-pages` defaults to 1,638,400 and controls physical memory available through Region.
- [Deployment recipe](https://github.com/dfinity/icp-cli-recipes/blob/motoko-v5.1.0/recipes/motoko/recipe.hbs): delegates to Mops. Existing deployed build configuration has not been changed.

## Implementation

- `multiRegionBytes.mo`: bounded eight-bank address space, 64 GiB strides and a partial final bank at 500 GiB; each extent belongs entirely to one bank.
- Original stable store and all old Slice offsets remain bank zero. New migration `20261109_000000.mo` adds only an empty bank map; it allocates no Regions and copies no files during upgrade.
- Extra-bank writes require `IGNITE_MEDIA_MULTI_REGION_LOCAL_REHEARSAL=1`. Production still has the existing 64 GiB configured ceiling, existing 80% admission, file limits, metadata cap and club allowances.
- Rehearsal configuration is capped at **200 GiB**, not 500. Real growth budgets block-rounded aggregate Region bytes with a conservative 64 MiB reserve; this is not measured full-payload headroom or a canister-wide space guarantee. Other stable state and runtime allocations still share the canister's platform memory.
- Files, pending physical reservations, finalized reads, HTTP streaming, aborts, deletes, retention and replacements route through bank-qualified addressing. Reads and cleanup remain possible when extra-bank writes are turned off.
- Root-growth telemetry reports zero for multi-bank rehearsal rather than fabricate guaranteed commitments. Packed/segmented/club-arena prototypes remain unchanged, unwired fixtures.
- Fixed the existing low-level `writeWithin` returned-error path to release its reservation if writing fails.

## Verification

- All **13 media Motoko test files pass**: 11 existing files plus address policy and near-500 GiB sparse address tests.
- Actual multi-Region sparse fixture writes/reads at virtual 64/128/192 GiB bank boundaries, preserves bank-zero bytes, rejects cross-bank/malformed addresses, reuses released slots, refuses configured exhaustion without mutation and survives a real memory-preserving upgrade.
- Near-500 GiB test uses only a sparse ~52 GiB final Region. Real reads/writes/deletion/reuse at address **536,870,846,464** pass; address **536,870,912,000** is refused. This does **not** allocate or validate 500 GiB aggregate memory.
- Actual production actor with a **local-only seed migration** rolls over to bank one, retains pending chunks/physical reservation through upgrade, finalizes/streams the bytes, refuses 500 GiB settings, and retains read/delete access when rehearsal writes are disabled.
- Saved pre-redesign 64 GiB module → candidate upgrade twice preserves old ciphertext, pending reservation/chunks, exact byte accounting and reuse; unauthorized and 500 GiB settings remain rejected.
- Real club-authority combined gallery/vault/chat allowance regression passes.
- Media and club actors compile with pinned Motoko 1.16.1; compiler warnings remain. All 17 active Candid contracts pass drift checks. Preview reports build OK.

Sparse local fixtures initially exceeded PocketIC's default reserved-cycles limit. The dedicated local runner explicitly increases simulated cycles/reservation limits before installation. No paid fuel was used. A attempted seed-fixture → production-module upgrade correctly rejected a backwards migration tail; flag-off testing retains the fixture's own migration tail instead. Prior real-module compatibility is verified separately.

## Reproduction

Save the pre-redesign module as `MEDIA_PREVIOUS_WASM` before compiling the candidate. From `backend/media_blob_store`:

```sh
mops check
mops test --reporter files
mops build
moc=$(mops toolchain bin moc)
"$moc" $(mops sources) --max-stable-pages 3276800 \
  -o /tmp/media-multi-boundary.wasm fixtures/multiRegionBytesBoundary.mo
MEDIA_BOUNDARY_WASM=/tmp/media-multi-boundary.wasm \
  node ../../frontend/scripts/test-media-multi-region-boundary-replica.mjs
mkdir -p /tmp/media-multi-chain
cp src/backend/migrations/*.mo /tmp/media-multi-chain/
cp fixtures/multiRegionActorSeed.mo /tmp/media-multi-chain/20261110_000000.mo
"$moc" $(mops sources) --max-stable-pages 3276800 \
  --enhanced-migration /tmp/media-multi-chain \
  -o /tmp/media-multi-actor.wasm src/main.mo
MEDIA_MULTI_ACTOR_WASM=/tmp/media-multi-actor.wasm \
  node ../../frontend/scripts/test-media-multi-region-actor-replica.mjs
MEDIA_PREVIOUS_WASM=/path/to/saved-previous.wasm \
  node ../../frontend/scripts/test-media-multi-region-upgrade-replica.mjs
```

Test-only seed migrations and compiler flags must never be copied into a deployment configuration. Existing workflows, production compiler ceiling and flags were deliberately left unchanged.

## Remaining 500 GiB blocker

A reviewed compiler/runtime implementation supporting **more than 256 GiB aggregate Region memory**, with safe growth failure and upgrade compatibility for existing Region metadata, is required before 500 GiB physical boundary testing or activation. Simply adding banks, changing `--max-stable-pages`, or upgrading blindly to a newer compiler does not resolve this. Once that runtime exists, rerun sparse aggregate-growth/upgrade/accounting checks; no paid full-volume fill is required by this work.

Even then 500 GiB is the canister-wide platform ceiling, not 500 GiB of guaranteed photo payload; runtime metadata, indexes, block rounding and other stable data must fit too. This redesign does not certify full-volume performance, maximum club count or international group activation.