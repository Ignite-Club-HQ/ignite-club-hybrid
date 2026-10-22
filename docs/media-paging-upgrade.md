# Upgrade photo loading (both ICP groups)

One protected workflow releases faster Media page loading.

1. GitHub → Actions → **Upgrade photo loading (both ICP groups)** → Run workflow.
2. Optional: run `check` first (no changes).
3. Choose `upgrade`, type `UPGRADE BOTH GROUPS PHOTOS`, run, and approve the protected environment if asked.

What it does, in one run:
- Upgrades only the existing `media_metadata` canisters: Group 1 `mc4fq-jyaaa-aaaal-qxlta-cai`, Group 2 `z26lc-oaaaa-aaaal-qxp4a-cai`. Stable memory and settings are preserved; nothing is created, reinstalled, rewired or moved. Photo stores, PII/key services and other domains are untouched.
- Verifies both groups' original photo keys before and after.
- Journals every step on the `media-paging-upgrade-receipts` branch; an unknown install outcome stays pending and is resumed by readback, never replayed blindly.
- Calls `build_asset_page_index` (200 records per call, durable position) until both groups report complete, retrying only transient failures, then reads back a settled index.
- Refreshes routing evidence and commits the verified Group 2 fingerprint.

Until a group's index is complete the app keeps using the legacy complete gallery read, so photos never disappear mid-release.
Re-running after a failure is safe: it resumes from the journal and the canister's backfill position.
