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

Wire the ledger through immutable state migration and every authenticated baseline/reserve/commit/cancel/replacement/deletion/retention path; preserve journal and await-race semantics. Extend authoritative group admission and allowed entitlement changes to reserve measured growth capacity. Reconcile every group/store registry and expose exact global pending/mode evidence. Measure allocator pressure and workload performance, then obtain separate approval for live migration/expansion. No encrypted club moves, re-encryption, payment activation or group opening is included.