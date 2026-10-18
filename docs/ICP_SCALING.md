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
- These quota APIs are **governor-only preparation**, not live store APIs.
  Existing uploads still use the existing local quota checks. There is no
  activation switch, automatic deployment wiring or claim of live global
  enforcement. No additional free-club stores should be activated yet.

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
silently refund capacity. Bounded reconciliation/retirement remains required.

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

**Do not activate extra stores for free clubs yet:** existing quotas are
per-store, whereas the product allowance is per club. Summed browser reads
are not enforcement. An authoritative on-chain quota reservation/commit
service is required before distributing free-club writes across stores.

The new preparation ledger is only the first part of that service. Next:
freeze all participating stores, reconcile pending writes, import and verify
each current-cycle usage snapshot with retry-safe per-store imports, then
activate caller-store-gated operations and recoverable store-side finalization.
Keep operation links until commit/abort outcomes are confirmed. An uncertain
finalize must not cause an abort to refund an already-published file. Test
every interrupted call and cycle-boundary transition before cutover; no
fallback to independent local counters after global enforcement is enabled.

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

Rust placement/group tests, Motoko media policy tests, encrypted-upload tests
in both backend modes, offline media-recipe tests and Candid drift checks.
These do not establish deployed capacity, live migration compatibility or
authenticated mainnet behavior.