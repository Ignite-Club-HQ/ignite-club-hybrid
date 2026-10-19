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

Live readings and inaccessible fields are recorded below after bounded mainnet queries finish. Source findings above must not be presented as deployed facts.