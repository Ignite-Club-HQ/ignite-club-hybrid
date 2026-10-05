# Photo storage sharding plan

## Goal
Let photos spread across several photo stores on the Internet Computer, so no single store fills up. New stores can be added from Placement Settings with no app change and no data moves.

## What it means for you
- Today: one photo store holds every photo. One store holds roughly hundreds of GB before it gets expensive and slow to upgrade.
- After: you can add a second, third... store whenever you want. New uploads go to the store that isn't full. Old photos stay where they are and keep working.
- You'll see a "Photo stores" list in Placement Settings showing each store, how full it is, and whether it accepts new uploads.

## How it works
1. **Every photo already remembers its store.** Each saved photo records which store holds it. The app reads it from there. Nothing about old photos changes.
2. **A list of stores.** Placement Settings gets a list of photo stores. Each one is marked "accepting uploads" or "full (read only)".
3. **Choosing a store for a new upload.** The app picks a store that accepts uploads. The choice is stable per club, so a club's photos stay together (easier to delete a club or move it later). If a club's store is full, it moves on to the next open store.
4. **Fullness tracking.** Each store reports how much it holds. When it passes a limit (e.g. 80%), it stops accepting new uploads by itself and the app uses the next one.
5. **Deleting and access rules** work the same in every store: the same encryption, the same club-admin delete rights.
6. **Country engines.** Cloud Engine targets can list their own photo stores, so photos for a residency country stay on that engine.

## Steps
1. Photo store canister: add a "how full am I" report and an automatic "stop taking uploads" limit (new migration, no changes to existing data).
2. Deploy script: able to deploy extra photo stores (media_blob_store_2, _3...) with the same setup calls.
3. Settings: store list with open/full flags, saved like canister IDs today; Placement Settings card to add/mark stores and show fullness.
4. Upload path: pick a store per club using the list; fall back to the next open store if the chosen one refuses.
5. Read path: unchanged (already follows each photo's store record); add a check that the store is in the approved list.
6. Tests for store choice, fallback when full, and old photos still loading.

## Technical details
- `media_blob_store`: new migration adds `capacityLimitBytes` + `totalBytes`; `get_usage()` query; `begin_upload` rejects with `StoreFull` above limit. Update `.did` + both binding dirs, run drift check.
- Config: `icp_canister_config` gains `mediaBlobStores: { id, writable }[]`; legacy single `media_blob_store` id treated as store #1. Cloud Engine targets may carry their own list.
- `live/mediaUpload.ts`: `pickBlobStore(clubId, stores)` = rendezvous hash over writable stores; on `StoreFull` retry next. The vetKeys PII registration is unchanged (pii_id = storagePath).
- `live/mediaStorage.ts` / `mediaDecrypt.ts`: resolve by `blob_ref.canister`; reject canister ids not in the configured list.
- `scripts/deploy-mainnet.sh`: loop over `MEDIA_BLOB_STORE_COUNT`, running `set_club_domain_canister` + GOVERNOR env per store.
- AGENTS.md rule: stores are append-only and photos are never rebalanced; a full store becomes read-only.
- Needs a mainnet deploy for the canister part; the app side works with a single store until then.
