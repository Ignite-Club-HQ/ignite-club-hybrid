# ICP scaling foundation and activation gates

## Status

This release hardens existing media admission and adds stable club-group
planning records. It does **not** activate production multi-group routing,
deploy new canisters, move clubs, or migrate stored ciphertext.

### Implemented

- Cross-group reads: `shard_router.read_hosted_club_assignment` returns only a
  club's group (authenticated, deployment-bound, revision-checked) so a reader
  can open a competition hosted in another group; destinations keep their own
  access rules and hosted lookups never widen write membership. Team entries in
  any group are found with a bounded every-group read. Competitions stay with
  the hosting club by design; sponsor counters are club-owned and move.
- Membership discovery uses the indexed club pager, falling back to the scan
  pager only for app-wide accounts.
- The move tool refuses any canister without move endpoints (fail closed) and
  folds older sponsor-only counts into the club when it locks.
- Deployment-bound preparation (`frontend/src/live/groupDeployment.ts`) validates
  approved identity/revision/HTTPS origin/network against every domain's subnet
  placement. Secondary approved subnets remain gated; cache scopes isolate account
  and deployment. Explicit inactive read sessions now ingest consensus router
  metadata, never browser-authored approvals. No Cloud Engine selected or created.
- Integrated group-read stage: immutable governor-attested router placement in
  stable partition 8; authenticated consensus registry reads; private assignment
  reads call assigned club authorities and reject revoked, unavailable, foreign
  or stale results without partial data. Caller/locally-linked membership pages
  scan at most 200 profiles and return at most 100 IDs. This is bounded offset
  traversal, NOT indexed or snapshot-consistent membership storage; cross-group
  linked-account synchronization and ACL revision coverage remain unfinished.
  Current memberships are rechecked before feature reads.
  `groupSessionLive.ts` connects only when explicitly called, never in production
  dispatch. Lazy adapters cover profiles, teams, subscriptions, events and
  forward-paged messages. All 13 domain IDs move together; global services stay
  unchanged. Coalescing isolates host/network/IDs. Mixed engines reject without
  fallback. Real isolated two-club-authority/router tests verify private pages,
  revocation, anonymous/foreign/stale denial, upgrade persistence and unavailable
  authority. Other domain IDs are fixtures, not complete feature-group testing.
  Placement is operator-attested, not independently measured. Nothing deployed.
- Coordinated recovery core (`scripts/media-recovery-coordinator.mjs`) requires
  exact inventory, stops stores before authority, checks all stopped before
  snapshots/restores, rejects partial manifests and leaves failures stopped.
  Explicit verified resume starts authority first and refences on start failures.
  Unit and real local stop/status/snapshot/load/start tests preserve ciphertext,
  permissions and exact quota. Not a production command: authenticated inventory
  adapters and content/ledger consistency verification remain.
  Replica inventory and load receipts are fixture/in-process only. A stopped
  authority cannot answer ordinary queries; production needs independently
  readable verified registry metadata. Stopping shared authority pauses other
  features too and needs a maintenance window. Admission-only drain/seal is not
  implemented. No changes deployed.
- Local operator workflow (`scripts/media-recovery-receipts.mjs`) adds exclusive
  locks and atomically replaced, file-and-directory-synced receipts. Intent is
  saved before mutations and acknowledgements afterward. Interrupted/failed
  restores cannot resume: replay every snapshot while stopped. Failed resume
  refences participants and requires full restore before retry. Storage failure
  retains the lock; crashed locks never expire automatically. Investigate the
  old process and actual participant statuses before manual unlock. Use an
  operator-owned durable directory per checkpoint. Receipts contain no secrets
  or plaintext media and are not authorization. Adapter consistency verification
  and explicit approval are still required. Disk reload and actual process-exit
  tests are local only, not production controller or ledger/content verification.
  Partial checkpoints need manual snapshot reconciliation, not guessed retries.
- Recovery-evidence contract (`scripts/media-recovery-evidence.mjs`) defines
  complete per-store ciphertext, file index, allocator, ownership and upload
  journal hashes, plus authority quota ledger, journal and store registry hashes.
  Streaming hashing checks exact sizes with chunks capped at 1,000,000 bytes.
  Comparison binds every participant to its checkpoint snapshot, module, subnet,
  deployment, registry revision, network and HTTPS host. Missing/duplicate evidence
  or any changed section blocks resume before starts. Historical quota accounting
  must be retained: counting current files cannot prove ledger consistency.
  This is an offline contract and optional coordinator gate, NOT an implemented
  production reader or proof of input provenance. A reviewed authenticated reader
  must extract actual complete checkpoint/restored state while the entire set is
  stopped, independently verify its origin and fencing, and use canonical section
  encoding. Existing canister methods do not supply these exports. Never supply
  operator-authored digests or merely successful load receipts. All 29 recovery
  tests pass locally; no production commands, routing or canister contracts change.
- Snapshot-byte reader (`scripts/media-snapshot-reader.mjs`) uses the official
  `read_canister_snapshot_metadata/data` management interfaces for existing
  snapshots. Module, heap and stable memory stream in exact-size bounded reads;
  globals, certified data, timers and uploaded module chunks are also compared.
  Snapshot timestamps/versions differ after a new observation and are excluded
  from state equality, but must remain unchanged during an individual read.
  Decoded floating NaN payloads may normalize; no bitwise NaN claim is made.
  Local PocketIC verification (`frontend/scripts/test-snapshot-reader-replica.mjs`)
  proves controller-only metadata reads, changed stable-byte detection and
  restored module/heap/stable equality while stopped. This is raw captured-state
  comparison, not a decoder for the named application sections above. Production
  needs authenticated management transport, independently verified destination
  placement, full-set continuous fencing, durable receipts and coordinated
  observation snapshots after every restore. The local transport is fixture-only;
  this increment does not supply or activate a production recovery command.
- Snapshot/receipt integration (`scripts/media-recovery-snapshots.mjs`) is opt-in
  for local adapters. Durable receipts bind complete raw baselines to placement
  and checkpoint IDs, record read intents/results, then compare fresh stopped
  observation snapshots after restore and again before resume. Evidence-required
  receipts cannot silently omit the reader or adopt a legacy baseline. Every
  management read checks the whole inventory and independently supplied placement;
  failures refence the participants. Raw equality never replaces semantic checks.
  Sampled statuses cannot establish continuous exclusion of another controller:
  production still requires an exclusive controller fence, authenticated transport
  and decoded quota/content verification. No live adapter or activation is added.
  All 45 local recovery tests pass. The three-canister rehearsal in
  `frontend/scripts/test-recovery-receipts-replica.mjs` uses real management calls
  and disk receipts to deny changed stable bytes, restore the entire inventory,
  and resume authority-first. Its minimal fixtures have no application quota
  ledger, and its logical HTTPS placement is fixture-only, not production proof.
- Unbounded-wait responses are delivered; bounded-wait calls can report unknown
  outcomes after remote commit. PocketIC 0.23.0 exposes no response-drop API.
  Client loss and unavailable-authority tests are not substitutes; genuine
  post-commit unknown-outcome injection remains an activation gate.

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

### Stable media storage — implemented, not activated

`media_blob_store` now supports indexed Region-backed ciphertext and bounded
HTTP streaming for both legacy and stable files. Each response chunk is at
most 1,000,000 bytes; tokens pin the content hash and stop after replacement
or deletion. URLs, MIME, ownership and ciphertext hashes remain unchanged.
Migration `20261027_000000` only initializes empty storage/index/cursors; it
does not copy bytes during an upgrade. Existing files remain readable.

Governor-only `migrate_legacy_blob` copies at most one file (10 MiB plus
framing) per call and checks its read-back SHA-256 before removing the heap
record. It requires drained uploads and sufficient heap headroom. This is
**not** a rollback-to-old-code migration: once copied, old code cannot read
the new representation. Keep a canister snapshot before running it; recovery
uses a snapshot or forward-compatible code, never an older module alone.

```sh
node scripts/media-quota-cutover.mjs migrate-storage
node scripts/media-quota-cutover.mjs migrate-storage --apply --ack-all-stores
# Repeat until stable_storage_status reports legacy_count = 0 everywhere.
node scripts/media-quota-cutover.mjs enable-storage --apply --ack-all-stores
```

Stable writes are deliberately opt-in and cannot enable with legacy files or
pending uploads. Logical and allocated stable capacity stay conservatively
capped at 2 GiB, not hundreds of GiB. Power-of-two slots reuse deleted space;
Region pages do not shrink and fragmentation can cause a StoreFull rejection.
Replacement needs space for both old and new ciphertext until atomic commit.
Metadata is capped at 100,000 records. No automatic growth or provisioning
claims are made. Upload chunks/hash assembly still use bounded transient heap.

Retention covers both representations, skips unknown/Pro clubs, rechecks a
record after subscription awaits and rotates past the first 50 legacy clubs.
The local PocketIC script verifies maximum-size streaming and copy, permission
denials, idempotent migration, slot reuse, EOP upgrade preservation, two-store
quota activation, concurrent pending allowance, abort/finalize behavior,
30-day allowance renewal and six-month known-free retention:

```sh
# Build club_domain and media_blob_store with mops in each canister folder.
# From frontend/: install the pinned local replica binary once.
node node_modules/@dfinity/pic/postinstall.mjs
node scripts/test-media-storage-replica.mjs
```

The pure frontend `groupRouting` resolver/batch partitioner is tested but
**not connected to production actors**. It rejects missing assignments,
incomplete groups and wrong deployments. It is not authorization or membership
discovery; the group activation gates below remain unfinished.

The isolated `executeClubBatches` helper resolves every request before any
destination read, executes one batch per group and restores the original order
including duplicates. It rejects incomplete/extra result slots and propagates
permission or shard failures instead of returning partial data. Ten tests pass
in each backend mode. Live actors and membership discovery are unchanged.

### Recovery verification — local replica only

The same integration script now uses actual management-canister snapshot
calls: a noncontroller snapshot is denied; a controller snapshot restores
Region ciphertext, allocation index, metadata, byte totals and owner checks
after overwrite/new-file writes. The test deletes its local snapshot afterward.
Restoration intentionally discards changes made after the snapshot, so production
recovery still requires a maintenance fence and a consistent quota-authority
snapshot; do not restore one media store against an advanced quota ledger.

Stopping the quota canister before begin/finalize injects a real inter-canister
rejection. Restart/retry keeps one same-path reservation, one final result and
exactly one allowance charge; abort cannot refund a committing file.

The coordinated local test drains/stops both stores and the quota authority,
snapshots all three, then commits an overwrite and second-store upload. It stops
all participants again and restores every snapshot before restarting authority
then stores. Bytes, hashes, allocator totals, owner-only outcomes and usage match
the checkpoint; exactly nine more uploads fit after its one retained charge.
This tests the local procedure, not automatic production recovery fencing.

The replica also discards a **client acknowledgement after real finalization**:
the real store and quota authority commit first, then the test adapter throws.
Owner outcome lookup, ciphertext read-back, an EOP upgrade and concurrent
same-ID finalization retries preserve the identical result without duplicating
bytes. Other principals cannot inspect, finalize or abort the upload. Exactly
nine more uploads fit across both stores, proving the lost acknowledgement
consumed one slot rather than zero or two.

A separate case upgrades the store while its commit is uncertain because the
authority is stopped. The upgrade preserves ciphertext and the no-refund fence.
After the authority restarts, only the governor can reconcile; the test follows
bounded journal cursors through all pages and settles exactly one uncertain
operation. Owner retry/read-back and nine remaining allowances then succeed.

These tests do **not** drop an inter-canister callback after the authority has
committed. That failure injection, production fencing, group migration and
mainnet/native verification remain open. No production canisters were changed.

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
6. **Stable-backed media and streaming:** code and local actor verification
   implemented above; deployed snapshot recovery, live compatibility and
   measured capacity verification remain required before activation.
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
## Offline registry and retention scaling

Group rows remain in router stable-memory B-tree 6; the safety bound is 4096
(<32 MiB at a conservative 8 KiB per validated row plus tree overhead), not 64.
`read_group_registry_page` scans at most 64 keys per message, includes matching
placements, and pins continuation to an exact revision. Empty pages may advance
over another target. Both consensus reads must keep that revision; changes fail
closed rather than restart into a different inventory. The legacy read errors
when more than one bounded scan is needed. No live gates change.

Identity denial and erased-account B-trees (memories 6/7) already support direct
stable growth and revision-pinned history pages. Their safety budget is now
32 GiB / 8 KiB per account including eight denial rows (4,194,304 accounts),
not 10,000 accounts / 80,000 denials. Receiver persistent core maps retain
fences without upgrade serialization; reserve 512 MiB each at 1 KiB per intent
and 128 B per subject (524,288 intents / 4,194,304 subjects). These are
conservative accounting budgets, not an assertion of available memory; storage
exhaustion must refuse and never prune history. Requests still touch at most
eight subjects, and exact retries, terminal denials, immutable fences, and
receiver-local (not global-completion) receipts remain unchanged.
