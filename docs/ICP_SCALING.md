# ICP scaling foundation and activation gates

## Status

This release hardens existing media admission and adds stable club-group
planning records. It does **not** activate production multi-group routing,
deploy new canisters, move clubs, or migrate stored ciphertext.

### Implemented

- Heap-backed media capacity is capped effectively at 2 GiB, with admission
  stopping at 80% and additional 3 GiB heap headroom checks. These are
  conservative application budgets, not platform storage guarantees.
- Pending declared upload sizes count toward admission, including after
  subscription awaits. Chunk size/count, aggregate received bytes, path/MIME
  length and outstanding upload counts are bounded. Old files remain readable
  even if a store stops accepting new uploads.
- Plaintext files are capped at 10 MiB before encryption; the wire protocol
  permits 64 KiB additional encryption framing. Final assembly is linear.
- `shard_router` stores complete domain groups and club assignments in new
  stable-memory partitions 6 and 7 without changing earlier partitions.
- Group endpoints and target alias cannot be edited. New assignments are
  atomic and retry-safe; capacity selection uses assigned-club utilization,
  heap budget, cycles, accepting state and readings no older than 15 minutes.
- All group operations are governor-only. Readings are operator reports,
  not independently measured or automatically polled. Use the maximum heap
  and minimum cycle balance across every canister in the group.
- Ordinary placement, residency and shard assignment cannot move existing
  data. Existing migration methods remain route-only and are **not** proof
  of data copying. Group migration is deliberately blocked until verified
  group-wide migration exists.
- Shared quota preparation now has indexed persistent maps in `club_domain`,
  a governor-only trusted-store registry and idempotent reserve/commit/release
  logic. Reservations include outstanding writes across stores; free caps
  remain 10 per category and 25 MiB for vault/chat files. Pro/trial allowance
  is derived from authoritative subscription flags, never a browser flag.
- Shared quota activation and recoverable upload APIs are implemented, but
  not deployed or live-verified. Direct frozen-store snapshots are imported
  in bounded pages; duplicate keys are rejected. Persistent reserve/commit/
  release journals retry unchanged operations; unknown outcomes never refund
  published bytes. Do not activate extra stores before live verification.

## Deployment of this foundation

Run the existing governor-controlled backend workflow to upgrade
`media_blob_store`, `shard_router`, and `placement_registry`; deploy the frontend
and rebuild native apps for the plaintext limit. Never reinstall or replace
memory. No new Motoko stable fields are introduced; no migration file is
required for the media admission change.

The later shared-quota preparation requires a `club_domain` upgrade with
additive migration `20261025_000000` (frozen inline map records). Do not edit
earlier applied migrations. Its new state is empty and does not replace or
reset existing per-store counters. The quota maps are hard bounded at 100,000
entries each, store registry at 64 and outstanding club/category reservations
at 64; exceeding a bound rejects new work rather than growing indefinitely.
No reservations expire automatically: unknown finalization outcomes must not
silently refund capacity. Migration `20261026_000000` adds isolated cutover
state and media journals without resetting legacy data. Recovery scans 20
outcomes; retirement scans 200 keys per map with cursors, deleting collected
keys after iteration. Only old terminal outcomes are retired.

Before upgrading: capture module hashes, usage and memory readings. Afterward:
verify old ciphertext URLs/hash values, ordinary-member uploads, staff deletes,
quota rejection and reservations under concurrent uploads. The effective
capacity change closes an already-over-budget store to new uploads without
deleting files. Check this before deployment and provision capacity if needed.

## Prepare another media store

```sh
node scripts/prepare-media-shard.mjs media_blob_store_2
node scripts/prepare-media-shard.mjs media_blob_store_2 --apply
```

The first command previews; the second creates a recipe and matching mops
configuration using shared media source/migrations. Neither changes deployment
manifests, funds canisters nor modifies mappings. Add the path and environment
entry to the appropriate target manifest only after the following gates pass.
The existing deployment script wires `media_blob_store_N` to `club_domain`.

### Shared-quota cutover — explicit operator action

Upgrade club_domain and EVERY media store first. Ordinary deployments do not
activate quotas. Inventory every store, including inactive stores; the target
mappings must include them all or usage is undercounted. Use ICP CLI 1.7.0 and
set GOVERNOR to the deployed governor principal.

```sh
node scripts/media-quota-cutover.mjs register
node scripts/media-quota-cutover.mjs register --apply
node scripts/media-quota-cutover.mjs freeze --apply --ack-all-stores
node scripts/media-quota-cutover.mjs import --apply
# Repeat import until every returned store status has done = true.
node scripts/media-quota-cutover.mjs activate --apply --ack-all-stores
node scripts/media-quota-cutover.mjs recover
```

Without --apply this prints commands only. It never deploys, reinstalls or
moves files. Freeze rejects pending uploads; finalize/abort them first.
Plan a maintenance window: reads stay available but writes pause until
activation. No return to local quota is allowed after freeze. Fix errors and
resume the same phase. Imports are retry-safe; activation rejects incomplete
registered baselines. After activation, register/freeze/import/enable new
stores without pausing already active stores; a new store cannot use shared
quota before its own import finishes.

Recover with --apply reconciles unknown reserve/commit/release outcomes.
Follow returned cursors using QUOTA_CURSOR and QUOTA_USAGE_CURSOR; select one
store with MEDIA_QUOTA_STORE. Each store's cursor is independent. Writable
unfinished uploads are not auto-aborted: owner/governor explicitly aborts
abandoned work. Owner-only outcome lookup lasts until terminal retirement.
Usage display sums successful per-store uploads; pending reservations can
temporarily enforce stricter allowance. No fallback to local counters after
activation. Actor-level interruption and cycle-boundary tests remain required.

## Required before production multi-group activation

1. **Membership/account discovery:** authoritative account-to-club-group index;
   page through the caller's clubs across groups, with no public membership leak.
2. **Complete scoped routing:** club/team/event/conversation/vault IDs resolve
   to an immutable assignment. Batched multi-club reads split by group and
   merge without dropping rows. Global, personal and competition data have
   explicit owners. Existing clubs remain in the legacy group.
3. **Cross-group authorization:** each shard checks ownership; membership and
   role revocation use the correct authority. Replace single-pointer trust in
   PII/vetKeys, queues, rewards, competitions and purge fan-out with a bounded
   authorized registry. Never trust a browser-provided canister ID.
4. **Notifications and timers:** sender trust, inbox aggregation, scheduled
   delivery, worker polling and account deletion cover every group; use
   idempotent writes and bounded retries. Do not share a queue that trusts only
   one messaging sender between multiple messaging groups.
5. **Indexed bounded storage:** replace whole-array scans/copies in hot club,
   chat and event paths with keyed indexes and capped cursor pagination;
   preserve each method's existing permissions and result semantics.
6. **Stable-backed media and streaming:** introduce a new versioned storage
   representation with dual-format reads and bounded copying. Preserve URLs,
   encrypted bytes and hashes. Test HTTP streaming and large-file recovery
   before dropping any legacy heap record.
7. **Verified migrations:** snapshot + write fence + bounded copy + manifests
   and hashes + ACL checks + cutover + rollback. Route commits alone do not
   migrate data; do not use them as a toggle.
8. **Capacity/provisioning:** measure request load, latency, heap peaks, storage
   growth and cycles; configure per-group limits from those observations,
   provision only when necessary, and audit controller/wiring settings.
9. **Live verification:** authenticated creation, navigation, multi-club lists,
   send/reopen, uploads, scheduled delivery, role revocation and restore on
   distinct groups, on web and native, before accepting real clubs there.

## Validation in this change

Rust placement/group tests, Motoko media policy/cutover/retirement tests,
encrypted-upload and lost-acknowledgement tests in both backend modes, offline
media-recipe/cutover safety tests and Candid drift checks.
These do not establish deployed capacity, live migration compatibility or
authenticated mainnet behavior.