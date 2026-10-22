# Bounded ICP gallery reads

## Implemented locally

The additive `list_assets_page` query and exact-signature protected consensus twin seek the owning club's ordered index. Each request returns at most 60 assets and examines at most 200 candidates. Empty pages can still have a continuation when hidden/deleted records exhaust the scan budget. Current owner/public/member/governor visibility, expiry, admission and removal checks remain in force.

The migration after the existing tail creates an empty nested index and durable backfill position; it does not copy/transform photos. Governor-only `build_asset_page_index` scans at most 200 records per call, is idempotent and resumes after an upgrade. Registration maintains the index during backfill. Physical snapshot drop/import invalidates locators and requires bounded rebuild. Scope/blob/role/delete/rekey changes invalidate revision-pinned cursors. Legacy zero timestamps sort last, with exact asset-ID tie ordering.

The primary ICP Media page reads one initial page per authorized club, publishes ready photos independently and exposes **Load older media**. It does not automatically drain every page. Continuations coalesce, retain loaded sibling data on failures and merge split albums by exact IDs. Unexhausted or failed feeds never become complete persisted snapshots. Cursors stay inside the account/target's request closure, not browser storage.

Older canisters and explicit index-not-ready first pages retain the unchanged complete-list API. This compatibility path is **not bounded** and must not be described as a live speed improvement. Permission/network/stale failures do not fall back. Other complete-list consumers, including the numeric-offset media repository, gallery copy and Vault, remain unchanged; they require explicit cursor contracts rather than silently receiving a partial list.

## Local validation

`frontend/scripts/test-gallery-paging-replica.mjs` installs the repository's recorded pre-index `main.wasm`, prints its public SHA-256, populates 405 photos, then upgrades to the local candidate. It checks 200/200/6 backfill batches, restart during backfill, concurrent registration, exact descending/duplicate-free traversal, empty nonterminal visibility-filtered pages, owner/public/member/anonymous checks, invalid limits/cross-club/stale cursors, role/delete/scope/blob/rekey invalidation, import/drop rebuild and surviving other-club records.

The recorded fixture SHA-256 is `9e35b10adb835f01fa2b18a35d6b3419fcf7e257021f1ef01a8154402000874b`; it is not certified evidence of the current mainnet module. Before release, pin the actual deployed baseline and repeat preservation/readback checks. Local candidate compiles; 17 generated contracts agree; ICP guards and changed live-code lint pass. Complete suites: ICP 5854 passed/760 skipped; Supabase 6256 passed/358 skipped. Public `/media` reaches a visibly rendered `/auth` with zero page errors; private gallery behavior and actual account timings remain unverified. Preview build OK.

## Release gates

No mainnet canister changes, photo moves, encryption/key changes, capacity/pricing changes or publication occurred.

1. Prepare a separately protected exact media-metadata-only release for the current registered groups; do not use a broad all-service upgrade or touch blob/PII services.
2. Verify live baseline, controller/subnet/inventory/settings and journal intent/readback. Preserve original modules/data and update only the exact affected fingerprints/verified routing evidence.
3. Upgrade existing metadata canisters, resume governor backfill automatically in the same release until each reports complete, verify list equivalence and authorized page readback. Do not ask the operator to hand-run a series of build modes.
4. Only then publish/update compatible web/native bundles and verify real-account cold/warm navigation and photos. Old canisters remain usable through compatibility meanwhile.

The exact protected media-metadata workflow is not implemented in this batch. Governor/GitHub credentials and a usable Internet Identity session are unavailable here; no production timing is claimed.