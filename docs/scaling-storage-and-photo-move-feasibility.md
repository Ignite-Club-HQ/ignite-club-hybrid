# Storage growth and photo-bearing club move feasibility

Investigation: 19 October 2026 UTC. Approved scope: Batch 1, read-only analysis and evidence; no runtime changes or live mutations.

## Conclusion

New-club rollover alone cannot protect existing groups from filling. Safe photo-bearing club moves are **conditionally feasible in principle, not implemented or releasable today**. Keeping the original key-derivation canister may preserve old ciphertext access while storing the ciphertext elsewhere; retaining the original blob bytes is not inherently required. This needs independent proof for all audiences and file types.

The lower-risk capacity relief is larger stable storage in the same store, followed if necessary by additional stores attached to the same group and original encryption authority. That avoids changing existing URLs and encryption identities. Additional stores still require correct combined cross-store accounting and separately approved activation.

## Confirmed source findings

### Capacity is not the allowance sold to a club

- `backend/media_blob_store/src/uploadPolicy.mo`: ordinary application ceiling 2 GiB; optional ceiling 32 GiB. Upload admission uses finalized + reserved + requested bytes at 80%, plus a separate heap-pressure check. Byte-only maxima are about 1.6 GiB and 25.6 GiB respectively, before other constraints.
- `backend/media_blob_store/src/main.mo:553-555,663-690`: large mode requires both the environment flag and stable writes. Same-store legacy migration copies one bounded object at a time, verifies its hash and preserves path/owner. Stable writes require no remaining legacy objects or pending uploads.
- `backend/media_blob_store/src/stableBytes.mo`: power-of-two size-class slots, minimum 64 KiB. Fragmentation can exhaust allocator capacity before logical byte admission. Deleted slots are reusable by their size class; allocated Region memory does not shrink.
- `deploy/groups/tested-limits.json` contains estimates, not measured capacity. Its 1,600,000,000-byte media budget is a decimal estimate, distinct from the exact 1.6 GiB source admission threshold.

### Combined allowance has a configuration-dependent gap

- `backend/media_blob_store/src/main.mo:735-760`: non-governor local-quota uploads check finalized + pending club bytes against 5 GiB plus purchased units. Pro classification depends on a recognized category path; the counted club prefix includes branding assets, but classification/coverage must be checked for every permitted path.
- `backend/club_domain/src/mediaQuota.mo:99-119`: shared reserve tracks category/cycle reservations and free monthly limits; it skips those limits for Pro and has no combined retained 5 GiB check. Existing local allowance tests do not prove shared or multi-store enforcement.
- `clubMediaBytes` scans one store's inventory. A club spread across stores needs authoritative retained-storage totals and pending reservations across all of them, not a sum guessed by the browser.
- Storage entitlements do not provision physical space. Preserve existing payment restrictions: ICP storage purchases remain disabled; do not enable them as part of capacity work. Audit allowed promo/entitlement changes and Pro transitions for capacity admission.

### Current move does not relocate photo payloads

- `frontend/src/live/mediaTransferSafety.ts:13-21` unconditionally rejects nonzero encrypted object counts. `mediaAuthorityReconciliation.ts` remains evidence-only, never move authorization.
- `frontend/src/live/groupTransfer.ts` omits `media_blob_store` from snapshot transfer domains. `groupTransferLiveAdapter.ts` copies/purges domain records, not blob payloads; serialized snapshot hashes are not decoded semantic ledger proof.
- Gallery persists `blob_ref`; chat carries URLs in messages/attachments; vault carries both file URLs and optional blob references. Changing the club assignment alone leaves those locations unchanged.
- `frontend/src/live/mediaDecrypt.ts:96-106,128-139` chooses the encryption target from store/group membership. It lacks a separately authenticated original-key-authority resolver for relocated ciphertext.

### Key continuity and source space are distinct

- `backend/pii_access_control/src/main.mo:155-178,602-663`: key derivation stays with the original canister and identity; club authorization delegation can change which club authority proves access without recreating the key.
- Private per-file, owner, explicit-reader, club-staff and competition permissions need separate continuity and revocation proof. Shared club-photo success is not private-file success.
- Keeping the original key service alive is compatible in principle with moving blob bytes. Keeping the original blobs or only moving records does not relieve the source store.
- A source deletion would lower logical bytes and return allocator slots, not reduce allocated stable-memory size or guarantee secure erasure. Success must measure genuinely reusable headroom under realistic new upload sizes.

### Recovery is not yet sufficient for blob moves

- Assignment CAS precedes saving the cutover phase; a lost response or disk failure must be reconciled against authoritative assignment before replay.
- After cutover the runner has no ordinary abort; sequential source cleanup is irreversible. Adding blob deletion needs an explicit forward-recovery protocol and durable deletion receipts.
- Ordinary `delete_blob` refuses fenced media; do not remove the fence merely to let a cleanup command run. A future operator protocol must authorize exact post-cutover cleanup safely.

## Required implementation before any photo-bearing move

1. Complete authenticated provenance/inventory for bytes, references, orphans, shared uses and pending uploads; unknown evidence blocks the move.
2. An authenticated media locator separating storage location from original encryption authority, with compatibility for legacy club and per-file encryption.
3. Durable original-club and private competition authority changes/restoration, with exact revisions and post-await denial checks.
4. Bounded resumable byte copies with hash/length/read-back checks and destination allowance/capacity reservations.
5. Reference updates or verified indirection across gallery, chat, vault, articles and private files; preserved access for legitimate readers and denied removed/unrelated readers.
6. Interruption-safe assignment/cutover and irreversible cleanup receipts; do not delete any source object while references still depend on it.
7. Measured reclaimed logical bytes and size-class reusable slots, followed by successful new uploads; no claim that stable memory shrinks.
8. Fresh-device browser/phone reads without cached decrypted photos, real push, removal, concurrent operations, upgrades and recovery tests.

A write pause is likely required for the club during a move; duration is unknown until measured against inventory size, request rates and retry behavior. No duration or credit estimate is established.

## Validation performed

Four existing focused files ran unchanged in both Supabase and ICP test configurations: `mediaTransferSafety`, `mediaAuthorityReconciliation`, `mediaKeyMoveRecovery`, `mediaStoreInventory`.

**46/46 tests passed per configuration (92 total executions).** These verify existing inventory, refusal and recovery rules, not successful encrypted moves or live key continuity. Preview's latest observed build entry was OK; no application code changed.

## Live evidence

Anonymous HTTPS queries against the configured primary store completed at **22:47:16–22:47:51 UTC on 19 October 2026**, using installed project bindings. No signed update calls were made.

| Reading | Live result |
| --- | ---: |
| Primary photo store | `jlaoy-dyaaa-aaaal-qxlpa-cai` |
| Finalized objects | 57 |
| Finalized ciphertext bytes | 3,848,218 (about 3.67 MiB) |
| Configured capacity | 2,147,483,648 bytes (2 GiB) |
| Accepting uploads | true |
| Stable writes enabled | false |
| Legacy objects / stable-indexed objects | 57 / 0 |
| Stable allocator high-water bytes | 0 |
| Heap / overall reported memory | 22,318,760 / 201,326,592 bytes |
| Running fuel | 3,694,408,693,345 cycles |

**Correction to earlier estimates:** the reported 201 MB is not stored photo payload. The configured primary store currently holds about 3.85 MB of ciphertext, approximately 0.22% of the source byte-only 80% admission threshold. That percentage excludes unknown pending reservations and other admission constraints; it is not a complete utilization reading.

Public placement and router route tables returned empty pages at revision 0. Governor-only group enumeration returned Forbidden. These responses do not prove there are no clubs or additional stores.

### Fields still requiring authorized evidence

- Complete live group/store registry, global pending reservations and exact local/shared quota mode.
- Deployed module hashes/settings tied to reviewed artifacts; sampled query compatibility does not prove all source logic is live.
- Complete legacy provenance and original-key attestations for potential moves.
- Signed consensus quota-cutover/store-registry reads: anonymous cutover status traps with Governor required. Anonymous `media_quota_ready=false` is caller-scoped and is not proof of global inactivity.

Your deploy key is not available in this workspace. These fields require an operator-authenticated read through your stored GitHub deploy identity. No private key should be pasted into chat. Public reads have established the primary store's actual usage and storage format, but not complete production acceptance.

## Consolidated implementation proposal — not yet authorized

### First: reliable capacity and accounting

Build a read-only signed evidence report for complete group/store inventory and quota status; keep the report separate from mutation workflows. Then add authoritative cross-store retained + reserved bytes, separate from monthly upload counts, covering all club-owned paths including branding. Baseline existing stores, journal reservations and deletion/replacement deltas, and block unverified stores. Reconcile allowed entitlement updates and remaining allowances before admitting clubs or increasing their capacity commitments. Investigate promo replay and expiry classification without silently changing commercial rules.

### Second: expand the existing group safely

Build/reuse a checkpointed same-store migration workflow for the 57 legacy objects, with verified read-back and recovery rehearsal. Test larger stable storage and realistic allocator pressure locally, then propose a separately approved mainnet test. Additional in-group stores can take future uploads without moving old photos, but only after cross-store accounting is proven. No 32 GiB activation is assumed.

### Third: optional safe whole-club moves

Implement the independently authorized original-key locator, full byte/reference move journal and post-cutover reclamation protocol listed above only after a separate move-specific plan explicitly replaces the current prohibition. Start with an isolated two-group rehearsal; prove fresh-device private-file access, denial and reused source slots before proposing mainnet acceptance. Original key canisters remain running; this is not full retirement of the source group. Re-encryption and automatic moves are not included.

### Acceptance boundaries

Use concrete tests for the 5 GiB plus add-ons boundary, cross-store concurrent reservations, free monthly limits, branding paths, retry/overwrite/delete accounting, entitlement changes, heap/index/allocator pressure and consistent recovery. Keep existing 70%/80% rules but evaluate true usable space and committed growth. Live larger-store activation, opening a group, and moving a club each require their own approval and existing scaling release gates.

Batch 1's source investigation and public live reads are complete. Authorized production evidence remains blocked on the GitHub-held operator identity; implementation and policy changes remain blocked on separate approval.

## Approved same-group implementation foundations — 19 October 2026

The owner approved the same-group recommendations. No live changes were made.

- `mediaRetainedQuota.mo` is a tested standalone ledger, **not yet imported into production canister state or mutation handlers**. It requires all registered stores sealed, counts pending and finalized bytes across categories, conservatively reserves replacements, and retains monotonically increasing revisions across deletion/recreation to reject stale refunds. Its caller must authenticate stores, derive Pro/add-on status on-chain and prove exact frozen inventory; its Boolean `pro` argument is not browser authority.
- `groupGrowthReservations.ts` validates exact deployment/group commitments and blocks the local placement planner when a required commitment cannot fit. It is **not the router's authoritative admission or entitlement-change protocol**. Physical commitments must include tested allocation overhead, not just the advertised 5 GiB allowance.
- Local Pro classification now uses the club path rather than monthly categories; a real replica test verifies logo reservations are counted. This closes that local path gap but does not make shared monthly quota accounting a retained ledger.
- `mediaExpansionPolicy.ts` sequences complete inventory, drain, migration, stable writes, capacity tests and operator approval. It performs no mutation. `Group media capacity report` performs signed reads with the stored deploy identity and records remaining evidence gaps; it does not claim complete inventory from primary-authority readings.

### Checks completed

Retained-ledger Motoko tests (including delete/recreate ABA denial), allocator/admission boundary tests, 25 existing placement/collector checks, 59 Supabase and 41 ICP upload/expansion checks, and 9 offline cutover/shard checks pass. The real local storage rehearsal passes migration/hash read-back, stable writes, owner denial, streaming, replacement/slot reuse, coordinated snapshots, retry/upgrade recovery and the opt-in 32 GiB setting. The real local Pro rehearsal passes combined accounting including logo reservations. The clubs and media canisters compile; preview log is OK. A root-wide Mops check encounters the existing events-domain `mo:ic` package resolution issue; scoped clubs/media compilation succeeds.

**The 32 GiB rehearsal verifies configuration and upgrade preservation, not a 32 GiB fill or representative performance test.** No safe club-count increase or live capacity activation is established.

### Remaining implementation and live evidence

The local ledger integration described below is complete; production activation is not. Extend authoritative group admission and allowed entitlement changes to reserve measured growth capacity. Reconcile every live group/store registry and expose exact global pending/mode evidence. Measure allocator pressure and workload performance, then obtain separate approval for live migration/expansion. No encrypted club moves, re-encryption, payment activation or group opening is included.

## Local retained-accounting integration — 19 October 2026

The authority and photo-store actors now import retained accounting through additive state migrations. The explicit `IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL=1` gate is required on both services; production installations reject cutover even for the governor. Do not add this flag to a deployment workflow.

- The authority captures an immutable store registry, then imports each store directly in bounded frozen pages. Legacy heap objects, stable-indexed objects, personal/orphan bytes, object revisions and exact complete counts/bytes bind readiness; unresolved club paths, changed evidence and incomplete stores reject activation.
- Shared monthly quotas remain separate from retained combined totals. Store-authenticated reservations cover club gallery, chat, vault and branding; Pro entitlement and purchased allowance come from the authority, never browser flags. Pending writes across both stores count before publication.
- Replacement revisions, durable reservation/commit/cancellation tokens and exact-object deletion locks preserve retry semantics. Deletion reserves authority journal capacity **before** removing ciphertext, then credits the exact revision. Unknown outcomes keep the path locked for retry; retention uses the same protocol.
- Frozen stores reject writes and publication. Authority outages fail closed. Coordinated recovery restores every store and the retained/monthly authority before restarting authority first; isolated-store recovery is not authorized.

### Verified locally

All 14 club-service and 6 store unit files passed before the final guard addition; the two retained unit files subsequently passed including the 100,000-entry deletion-journal boundary. Both final actors compile and their stable types are compatible with pinned pre-retained commit `6956b30d1`. The full two-store replica script starts from that old version and verifies additive upgrade with legacy and indexed ciphertext, authenticated baseline, combined pending/finalized totals, branding, replacement, outage/upgrade retries, deletion preparation/credit, free monthly limits and retention. Real controller snapshots restore both stores and both authority ledgers together; exact totals and object presence read back correctly. Production cutover refusal is tested.

Existing single-store Pro, full storage/shared-monthly recovery and bounded two-store inventory rehearsals also passed. Candid drift check passes for all 17 active contracts. These are isolated local canister tests, not signed-in live browser/phone acceptance or production activation.

### Still required

New local epoch-bound retained operations retire only after store acknowledgement and dual-ledger terminal settlement, in pages of at most 200 scanned records. Legacy authority operations and revision history remain retained. Expired unknown cancellation acknowledges absence without recreating reservations; replay cannot rebind the monthly cycle. Unresolved operations never expire automatically.

The local authority reserves growth before club creation, subscription publication and storage-promo grants. Commitments survive downgrade, deletion and upgrade, and uploads cannot exceed them. Router memory 12 now holds an immutable exact assigned-club baseline and monotonic per-club physical commitments. Placement reserves its free-club commitment synchronously with assignment. Authority calls are restricted to the assigned group's club canister and target; publication rechecks authorization and local data after the reply. Unknown outcomes retain commitments and same-club retries are idempotent; no refund or release endpoint exists. This can conservatively strand capacity after failed creation, by design, rather than oversell it. `IGNITE_MEDIA_GROWTH_LOCAL_REHEARSAL=1` and the additional authority `IGNITE_MEDIA_ROUTER_GROWTH_LOCAL_REHEARSAL=1` are local-only; no workflow sets them.

`frontend/scripts/test-media-capacity-workload-replica.mjs` measures mixed-size churn, reuse, physical exhaustion, readback and upgrade in isolated PocketIC; it never changes tested limits. Free slots now split and coalesce only along aligned buddy boundaries; existing ciphertext offsets never move, old unaligned slots cannot form overlapping larger extents, and allocation padding remains reusable. The same 16 MiB workload now holds 32 live 400 KB files (12,800,000 payload / 16,777,216 allocated bytes), compared with 19 before. Tests also refuse larger allocation across non-buddy holes while preserving live-file readback. This does not prove arbitrary future size mixes can fit an aggregate commitment, full-volume performance, or mainnet throughput.

Retirement now rechecks monthly terminal consistency when deleting, in addition to acknowledgement-time checks. Mixed eligible/unacknowledged/unexpired/legacy/malformed and unsettled-pair tests pass. Legacy tokens have no durable expiry, and path revisions prevent stale deletion from matching recreated files; neither may be pruned under the current protocol. This is a correctness boundary, not completed cleanup of all history.

Remaining gates: fragmentation-aware per-store growth proof, larger-volume/concurrent/mainnet measurements, signed complete live inventory and separate activation approval. The same real two-store authority rehearsal passes router binding, partial-baseline refusal, unavailable-router publication denial, retry, exhausted placement and router/authority upgrade persistence. Production configuration refusal is tested. No live canisters, capacity settings, group openings or club moves changed.

## Physical upload reservations — 20 October 2026

Local `IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL=1` reserves a real stable extent before quota awaits/chunks. Additive upload-ID ownership survives upgrades. Finalize writes the held extent before removing old ciphertext, atomically transfers ownership, and settled abort/local removal releases it. Unknown authority outcomes keep ownership. Older uploads remain retryable without a new guarantee. No deployment workflow enables this flag.

Authenticated local `read_physical_growth_capacity` reports revision, high-water, pending physical slots, old unreserved uploads and conservatively allocatable whole 16 MiB roots. Smaller fragmented holes count as zero. High-water already includes pending extents; do not double-count it. Telemetry is not tested usable performance capacity. The planner requires exact per-store measured limits and whole-root promises; aggregate-only or scattered cross-store space cannot approve new commitments.

Verified: 23 focused frontend checks; allocator replica tests; four held uploads/fifth refusal, authenticated capacity read, unauthorized denial, upgrade, lower-limit preservation, abort/reuse, mixed churn/32-slot fill in the 16 MiB real-canister workload; real two-store accounting/outage/snapshot recovery; 17-contract drift. Mops automatically discovers the additive migration; actual upgrade tests pass.

Lifetime future-growth guarantees remain incomplete: durable authority/router per-store future-root assignment is still required. Byte allowance alone cannot bound tiny retained file count; no customer file-count rule was introduced or assumed. An approved bounded object model or different proven allocator guarantee is needed, alongside larger-volume tests and signed live inventory/activation. Nothing changed live.

### Durable per-store admission budget — local follow-through

Router stable partition 13 binds an immutable budget to one registered photo-store principal, group, deployment target and club authority. Governor-only local import includes every assigned club, preserves all memory-12 promises and fixed overhead, and fits the individual store's supplied physical limit. Wrong store, partial/reduced baselines, duplicate configuration and shared-store double budgeting reject. Legacy aggregate-only budgets cannot admit clubs or publish router-backed grants. Placement/increases reserve synchronously in both ledgers; retries/downgrades never refund. Changed registry identity invalidates the budget.

This protects **imported physical promises**, not the accuracy of supplied limits or allocator roots inside the store. Current group routing binds future uploads to its single registered photo store; additional in-group store routing/allocator enforcement still needs integration. No new object-count limit, live flag or mainnet activation was introduced. Real subscription grants, stopped-router failure/retry, baseline refusals, production refusal and router upgrade persistence pass in the two-store rehearsal. Larger measured limits and exact live reconciliation remain necessary.

### Owned physical space — local primitive, not a completed release

`clubPhysicalSpace.mo` binds state to one shared region and assigns actual 16 MiB roots to club arenas. Shared allocation cannot reuse them. `reserveFreeWithin` has no tail fallback, so an exhausted club cannot borrow another club's roots or the shared tail. Allocation generations persist across upgrade; stale same-shaped write/release requests reject after reuse. Downgrades do not return roots. Failed acquisition returns acquired roots; region/high-water growth is not rolled back. State is trusted internal actor data, not public caller-controlled input.

The module is **not wired into production `main.mo`, authority grants, router admission or baseline import**. No actor state, migration, API, live flag, deploy workflow or allowance rule changed. The isolated actor fixture verifies isolation, oversale refusal, downgrade preservation, stale-request rejection, ciphertext readback and actual upgrade persistence. Eight store suites and 23 frontend checks pass.

The retained counterexample: 256 one-byte allocations exhaust one 16 MiB root at the current 64 KiB slot minimum; retaining one tiny allocation prevents a maximum-root request after all others are deleted. Root ownership **does not certify a full payload-byte allowance**. The global 100,000-record metadata limit is another barrier. Completion requires an approved physical-accounting rule or separately scoped packed-data/metadata redesign, exact existing-object import and all-path integration. No customer count limit was invented. Live expansion and encrypted moves remain off.

### Actual-size allowance preserved — packed ciphertext foundation

Owner selected actual file-size accounting on 20 October: never charge allocator overhead to the club or invent customer file-count limits. `packedClubBytes.mo` now suballocates 1–65,536-byte ciphertexts into owned pages using byte-sized buddy classes. In a real local canister, 1,024 one-byte files occupy one 64 KiB page rather than 1,024 pages. Handles retain exact lengths; power-of-two padding is not readable. Unwritten reused blocks return no bytes. Shared monotonic generations prevent old handle reuse even when a packing state or entire page is recreated. Deletion merges free buddies and returns empty pages only to the owning club arena.

Nine store test suites pass. The isolated upgrade rehearsal verifies packed ciphertext readback and stale-request denial after actual upgrade. Tests cover neighbouring allocations, mixed-size coalescing, exact read boundaries, cross-club denial, empty-page return and old-handle refusal after recreation. Zero-byte input and objects above one page are deliberately unsupported by this prototype; production paths remain unchanged.

Packing metadata is still held in internal persistent Maps: this does **not** solve the existing 100,000-record production cap or establish full allowance guarantees under adversarial fragmentation. Required next work is durable scalable metadata, large-object/fragmentation strategy, exact live/pending baseline, and integrated authority/router/store mutations. No actor field, migration, Candid interface, live flag or workflow changed. No further allowance decision is pending; actual file sizes remain the chosen rule. Nothing deployed.

### Larger ciphertexts and packed descriptor records — local follow-through

`segmentedClubBytes.mo` now stores fixed-width 48-byte segment descriptors in the same Region/club-owned packed pool as file tails. One small constant-size file handle replaces a persistent segment array. Full interior segments use owned 64 KiB pages; tails and descriptor records share packed pages. Tests store 512 one-byte files **and their descriptor tables in one page**. Exact file lengths remain separate from physical/table overhead; customer allowance rules are untouched.

Read/write calls handle at most 64 KiB, including reads spanning a segment boundary. Unwritten segments return no bytes. Identical upload retries succeed; changed retries reject. Completion means every segment was written, **not** a verified whole-file cryptographic hash or permission to publish. The isolated fixture tests 25 MiB files, partial-reservation failure rollback, ordinary abort/reuse, stale/foreign handles, malformed descriptor lengths without partial cleanup, and partial-upload continuation across an actual upgrade. No whole-ciphertext assembly is needed in this primitive.

The prototype is limited internally to 512 segments; this is not a new production customer upload limit. Generation encoding refuses overflow before allocating. Operations are bounded by this prototype cap but repeated reservations still scan the packed page pool; high-occupancy instruction/cycle acceptance is unmeasured. Descriptor shape/current ownership and an immutable file-generation interval are checked: synchronous reservation prevents another file's blocks entering the interval. Duplicate substitution within one file and tampering with internal mutable state remain outside the current proof; recovery receipts and fully hardened descriptors remain prerequisites to production integration.

**This is not a completed space guarantee:** per-file/page indexes still use Maps, metadata growth remains unbounded by payload alone, small pinned pages can prevent larger page allocation, and the existing production 100,000-record gate remains unchanged. Required next work is scalable indexing/metadata, worst-case physical headroom, hardened descriptor ownership, whole-file hash/publication and all-path baseline/authority/router/store integration. No actor migration, public API, deploy flag, live storage setting, group opening or club move changed.