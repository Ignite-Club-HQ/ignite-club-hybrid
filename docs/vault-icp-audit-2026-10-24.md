# File Vault ICP audit — 24 October 2026

## Status

Vault is **not fully closed or released**. Two independent source audits traced the app paths through live wrappers and canister implementations. The completion batch below repairs core authorization, paging, destinations and byte-cleanup issues locally. No production canister upgrade or app publication was performed.

## Repairs made in this audit

- Folder renames preserve restricted roles, ordering, description and colour. Explicit role changes remain supported.
- Mini-league folder/link writes send their actual club rather than an empty placeholder.
- Move destinations read on-chain folders, use account/backend/scoped query keys and preserve request errors with retry.
- Authorized team/club-root moves now use a destination-scope canister operation; competition folder traversal retains competition context.
- Large-file deletion matches ICP image IDs to the canister's file acknowledgements.
- Export thumbnails use the authorized/decrypted photo resolver; ordinary Vault photos no longer fall back to raw ciphertext URLs.
- ICP storage grants no longer expose Supabase recurring-downgrade controls; mutations also reject before an off-chain write.

## Remaining implementation gaps

### Completion batch implemented and locally verified

- Legacy private query endpoints refuse direct calls; protected reads establish current authority. Folder reads and writes apply scoped current roles and ancestor restrictions.
- File listings use revision-bound pages; a disposable canister with 205 files verifies continuation, stale-revision refusal, outsider denial and upgrade retention. The client falls back to an older deployed read only for a missing first-page method, never for denial or incomplete pages.
- Chat pins consult the configured messaging authority for canonical conversation scope, participation and management. Real canisters verify participant reads and outsider/non-manager refusals.
- Registered internal files require pinned-store hash and actual size evidence. Registration retries preserve the same file identity. Gallery IDs allocate monotonically rather than using current file count.
- Permanent deletion retains a hash-bound intent until physical bytes are confirmed absent; unknown/interrupted cleanup keeps metadata and blocks blind replay. Permanent tombstones prevent file-ID resurrection. Shared-byte references refuse individual cleanup pending reconciliation.
- Private chat mirrors make independent encrypted copies; raw URLs/zero-byte internal registrations are no longer accepted as copies.
- Metadata backups now restore through durable 40-row receipts, including inventories above 200 rows. Repeated cursors return acknowledged progress; interrupted reads resume after an upgrade. Restoration never overwrites current rows, widens decryption grants or revives erased-file IDs.
- Exact club/team media allowance controls paid Vault access; personal global Pro does not unlock an unpaid club. Media usage failures remain errors instead of publishing incomplete zero/low totals.
- Reciprocal Vault/messaging/store wiring is included in provisioning/release configuration; no wiring has been applied live.

### Still-open engineering and integration limits

- Uploads persist owner/store/path/hash/destination intents before bytes or access records. Vault entry now scans the caller's owner-wide journal independently in each group, including unopened clubs; file reads share the same scan. Only the owner can read an intent. Non-ready uploads reconcile by reading/decrypting the existing PII hash marker, requiring its exact original ciphertext hash, then acknowledged strict scope grants and canister-checked original store/hash/size before registration. Missing/mismatched markers remain unresolved without rewriting, deleting or re-uploading. Failed pages retain their cursor. This closes readback recovery where bytes and access records actually committed, not absent records or abandoned partial bytes.
- Backup downloads now stream validated JSONL records directly to a selected writable file on browsers supporting the File System Access API, with write backpressure and final close only after complete validated traversal; later-page/disk failure aborts temporary output. Unsupported browsers/native WebViews retain the existing memory-bound Blob fallback. ZIP exports remain memory-bound. This is not a universal device-memory-independent download implementation.
- Account erasure scrubs uploaded file/created folder rows from other administrators' snapshots, clears local role grants and stale pins/gallery mappings, and invalidates active export revisions. Blob retention and physical erasure still require original-store cleanup provenance and durable coordinated receivers under the existing separately gated lifecycle design. Missing physical bytes are not recovered by a metadata backup.
- Google Drive import/sync remains an actual external integration gap; blocking Supabase calls in ICP mode is not a replacement for Google authorization.
- Restored Internet Identity startup now reads routing configuration on-chain without consulting Supabase. Signed-out and email startup preserve existing hybrid precedence; purchase verification remains an approved payment exception.

### Further cleanup continuation

- Vault cleanup now delegates the original path/hash to the configured store under freshly verified caller authority. The client no longer performs a hash read followed by unrestricted path deletion; unknown outcomes retain the same intent without automatic replay.
- Repeated pending/completed cleanup is scoped and idempotent, preserves original trash timestamps and clears dangling file pins. Store deletion rejects pending same-path uploads in both local and retained modes. New registrations/restores cannot adopt a path reserved for cleanup.
- Retained deletion pins the original hash through preparation, rechecks transfer fencing before physical removal and acknowledges accounting settlement before Vault metadata removal. Legacy hashless pending retained receipts fail closed for explicit reconciliation.
- Account erasure preserves exact original store/path/hash/scope without file names in a new migration-backed cleanup record. Governor-only bounded reads and exact erased-file reconciliation preserve unknown/replacement outcomes; successful retries never duplicate credits. These are operator APIs, not an automatic sweep or proof of whole-account physical erasure.
- Disposable real canisters verify cleanup resume after upgrade, completed acknowledgement replay, outsider refusal, pending-upload refusal, replacement preservation, blocked new references, erased-provenance persistence and exact cleanup. A separate real retained-authority/store test verifies unavailable authority preserves ciphertext and balances, upgrade retains the receipt, and retry reduces retained bytes exactly once. Focused app tests pass in ICP and Supabase modes; interfaces and isolation guards pass.
- New lifecycle continuation: a bounded on-chain Vault timer drives original-hash cleanup, and configured stores stop independently retaining/deleting Vault paths. Stores recheck actual byte age, current exact-scope allowance, hash and pending writes. Free/expired-trial files expire after the existing 180-day window; paid/active trials remain. Permanent club/team erasure records exact authoritative receipts (absence/soft-deletion is not proof), and both Vault and store verify those receipts before cleanup. Account-erasure provenance is automatically reconciled in bounded pages; metadata/pins/gallery links and backup file rows are removed only after successful storage acknowledgement.
- Disposable real-canister checks cover intent/path locking, unknown-upload refusal, exactly-once post-upgrade registration, Free/paid/active/expired-trial retention, permanent club/team erasure and replacement protection. Focused tests pass in both modes. No mainnet changes performed.
- Empty folders now have a separate bounded lifecycle scan, requiring the configured club authority's permanent club/team-erasure receipt. It removes leaf folders and their pin/backup rows only when no file, child or unresolved upload still references them. Recursive hierarchies settle over subsequent sweeps; absent/soft-deleted scopes and unrelated club folders survive. A new migration retains the folder cursor across upgrades. Real disposable-canister tests verify soft-delete preservation, permanent team folder/backup removal and unrelated club preservation.
- Verification for this continuation: 37 ICP and 40 Supabase focused checks passed (mode-specific skips); Vault canister compile/build, 17-contract drift and ICP guards pass. The disposable real-canister suite passes existing recovery/retention/upgrade tests plus the added folder-erasure scenarios. No mainnet change or signed-in private UI verification.
- Account-erasure hierarchy now removes empty erased-owner chains and preserves ancestors needed by other owners' descendants/files/pending upload destinations; retained ancestor owner/deleter principals are scrubbed. Other admins' snapshots preserve usable hierarchy rather than orphaning surviving children. Real canisters verify shared descendants, removed empty chains, scrubbed principals, backup export and upgrade retention.
- Latest completion verification: 76 focused checks passed in each backend mode (19 mode-specific skips), Vault compile/build, 17-contract drift and ICP guards pass; the disposable real-canister suite verifies owner-wide intent reads/outsider denial and erasure hierarchies alongside existing recovery, retention, paging, deletion and upgrades. Public Vault redirects to sign-in with zero runtime errors; private signed-in acceptance remains unavailable.
- Still unfinished: uploads with missing/unreadable PII records and abandoned partial bytes need original-operation evidence, not automatic expiry/deletion; historical erasures require authoritative receipts unavailable for older deletions; Google import/sync requires secure OAuth credential transport and encrypted tokens; universal/native streaming and ZIP exports need a compatible writable sink/streaming archive implementation. Both-group protected upgrades/app release need separate authorization, and signed-in acceptance needs an II session. These are not claimed closed.

The original audit findings below are retained as a reference; several are addressed by the completion batch, and the unresolved limits above must not be described as closed.

### Authorization and inventory

1. `backend/vault_domain/src/main.mo`: legacy read endpoints authenticate but do not establish authoritative club membership when account admission is disabled. Protected read twins do not make direct legacy calls secure.
2. Pins validate the supplied club but not the actual chat's canonical club, caller participation or management authority. Team roots also need authoritative scope checks. Both read variants require conversation authorization.
3. Folder restrictions use local Vault grants rather than current authoritative scoped roles. Ancestor restrictions and destination/write restrictions need one consistent canister predicate.
4. Protected lists trap above 200 candidates without a bounded paging contract consumed by Vault, trash, export and large-file management.

### File lifecycle

5. Single-item permanent deletion removes metadata only. Bulk deletion attempts best-effort blob cleanup after deleting metadata and loses cleanup evidence on failure. Implement durable source-bound cleanup receipts; retain unknown outcomes and never blindly replay or refund.
6. Upload finalizes encrypted bytes before metadata registration without durable registration/reconciliation evidence. Pin a stable file ID and distinguish definite rejection from unknown commit before compensation.
7. Chat mirrors register original attachment URLs with zero bytes and no blob provenance, including unrestricted admin-chat folders. Preserve conversation authority and explicitly implement private independent copies or authorized non-owning references.
8. Gallery-copy IDs derive from current file count and can collide after deletion; source mappings retain removed IDs. Use migration-backed monotonic allocation plus collision checks and transactionally consistent mappings.
9. Restore and metadata backup paths can revive rows with deleted folders, expired/missing bytes or incomplete source mappings. Confirm actual availability and valid authorized destinations; do not describe metadata-only backups as complete file recovery.
10. Blob retention does not reconcile Vault metadata, so expired objects can still look available. Account erasure also needs coordinated handling of blob cleanup, retained shared records, local grants and pins without expanding the separately gated global lifecycle work.

### App parity

11. Add an atomic authorized destination-scope operation for team roots/club roots and preserve complete competition/mini-league scope when moving.
12. Competition folder deep links currently use the ordinary folder getter and discard competition context. Route authorized discovery/read and parent traversal through competition-specific reads, then construct the competition Vault view.
13. Storage display combines Vault-only categories with all-media/pending totals and can silently omit failed store reads. Use authoritative scoped allowances and distinguish unknown/incomplete usage from zero; personal global IAP must not grant paid club capacity.

## External capabilities

Google Drive OAuth import, linked-folder sync and title resolution remain Supabase-only and hidden in ICP. This is an actual missing integration capability, not an on-chain equivalent. Saving an external Google document link is already supported with on-chain metadata; its destination remains Google. Closing import/sync requires an authorized Google transport and encrypted token handling, not a fabricated Vault endpoint. Payments remain the approved external boundary; device encryption/cache and ZIP assembly are client processing, not off-chain data persistence.

## Verification and release requirements

- Focused dual-mode unit tests exercise the repaired app paths; regression coverage includes preservation of committee restrictions, exact move scope, errors and ICP image deletion acknowledgement.
- Completion verification: 12 focused files passed with 101 ICP and 131 Supabase checks (before two additional paging-compatibility checks); 17-contract drift and ICP guards passed. Real disposable Vault, club, messaging and blob-store actors verified outsider/direct-query denial, role revocation/ancestors, 205-file paging, stale revision, forged size/provenance, private pin permissions, idempotent registration, interrupted cleanup/tombstone and populated upgrade readback.
- Public `/vault` redirected to `/auth` with zero runtime errors. This is not signed-in Vault acceptance and does not verify private file opening on a phone.
- Existing and future canister changes require separately authorized exact protected upgrades in both groups, reciprocal authority verification, compatible web/native release and signed-in Internet Identity acceptance. No signed-in II session is available in this sandbox; private Vault UI acceptance is unverified.
- Continuation batch: startup isolation and backup continuation tests pass in both modes; real canisters verify >200 backup progress, exact repeated receipts, future-cursor denial, mid-restore upgrade resume and erased-file resurrection refusal. Unknown upload recovery and coordinated physical retention/erasure are not claimed completed.
- Further continuation: focused backup/export/upload/Drive characterization tests pass (ICP and Supabase); disposable real canisters verify summary creation, all rows over 40-row pages, outsider refusal, export invalidation after erasure, scrubbed snapshots and upgrade-safe restoration. No production upgrades or signed-in acceptance performed. Google Drive guidance now points to working encrypted device uploads rather than switching backend.